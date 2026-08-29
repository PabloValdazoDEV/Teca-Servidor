const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const { DateTime } = require("luxon");
const {
  CustomerValidationError,
  normalizeCustomerInput,
} = require("../utils/customerValidation");
const { materializePatientTemplates } = require("../services/documentStorage");
const preferredCommunications = require("../config/preferredCommunications");

router.use(authMiddleware);

router.post("/create", async (req, res) => {
  try {
    const enabledPreferredCommunications = new Set(
      preferredCommunications.getEnabledChannels()
    );
    const { customer, phones } = normalizeCustomerInput(req.body, {
      enabledPreferredCommunications,
      defaultPreferredCommunication: enabledPreferredCommunications.has("PHONE")
        ? "PHONE"
        : null,
    });
    const createdCustomer = await prisma.customer.create({
      data: {
        ...customer,
        ...(phones.length
          ? { phones: { createMany: { data: phones } } }
          : {}),
      },
    });

    let templatesCreated = 0;
    try {
      const templates = await materializePatientTemplates({
        prisma,
        customerId: createdCustomer.id,
        createdById: req.user.id,
      });
      templatesCreated = templates.length;
    } catch (templateError) {
      console.error("Patient templates could not be materialized", templateError);
    }

    return res.status(201).json({ customer: createdCustomer, templatesCreated });
  } catch (error) {
    if (error instanceof CustomerValidationError) {
      return res.status(400).json({ message: error.message });
    }

    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/all", async (req, res) => {
  const requestedPage = Number.parseInt(req.query.page, 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const offset = 10 * (page - 1);
  const rawSearch = typeof req.query.q === "string" ? req.query.q : req.query.name;
  const search = typeof rawSearch === "string" ? rawSearch.trim().slice(0, 100) : "";
  const normalizedSearch = search
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const digits = search.replace(/\D/g, "");

  try {
    let response;

    if (search) {
      const matches = await prisma.$queryRaw`
        SELECT DISTINCT
          customer."id",
          customer."fullName"
        FROM "Customer" customer
        LEFT JOIN "PhoneNumber" phone ON phone."customerId" = customer."id"
        WHERE strpos(
                translate(lower(COALESCE(customer."fullName", '')), 'áéíóúüñ', 'aeiouun'),
                ${normalizedSearch}
              ) > 0
           OR strpos(lower(COALESCE(customer."emailAddress", '')), lower(${search})) > 0
           OR strpos(lower(COALESCE(phone."rawValue", '')), lower(${search})) > 0
           OR (
             ${digits.length >= 2}
             AND strpos(
               regexp_replace(
                 COALESCE(phone."rawValue", '') || COALESCE(phone."countryCode", '') || COALESCE(phone."phoneNumber"::text, ''),
                 '[^0-9]',
                 '',
                 'g'
               ),
               ${digits}
             ) > 0
           )
        ORDER BY customer."fullName" ASC NULLS LAST
        LIMIT 10
        OFFSET ${offset}
      `;
      const orderedIds = matches.map((customer) => customer.id);
      const customers = orderedIds.length
        ? await prisma.customer.findMany({
            where: { id: { in: orderedIds } },
            include: { phones: true },
          })
        : [];
      const customersById = new Map(customers.map((customer) => [customer.id, customer]));
      response = orderedIds.map((id) => customersById.get(id)).filter(Boolean);
    } else {
      response = await prisma.customer.findMany({
        include: { phones: true },
        skip: offset,
        take: 10,
        orderBy: { fullName: "asc" },
      });
    }

    const sanitizedResponse = response.map((customer) => ({
      ...customer,
      phones: customer.phones.map((phone) => ({
        ...phone,
        phoneNumber: phone.phoneNumber?.toString() || null,
      })),
    }));

    res.json(sanitizedResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (query.length < 2) {
    return res.json({ customers: [] });
  }

  const normalizedQuery = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const digits = query.replace(/\D/g, "");
  const customerNumberMatch = query.match(/^id[-\s]?0*(\d+)$/i);
  const customerNumber = customerNumberMatch ? Number(customerNumberMatch[1]) : -1;

  try {
    const matches = await prisma.$queryRaw`
      SELECT DISTINCT
        customer."id",
        customer."fullName",
        customer."customerNumber"
      FROM "Customer" customer
      LEFT JOIN "PhoneNumber" phone ON phone."customerId" = customer."id"
      WHERE strpos(
              translate(lower(COALESCE(customer."fullName", '')), 'áéíóúüñ', 'aeiouun'),
              ${normalizedQuery}
            ) > 0
         OR strpos(lower(COALESCE(phone."rawValue", '')), lower(${query})) > 0
         OR (
           ${digits.length >= 2}
           AND strpos(
             regexp_replace(
               COALESCE(phone."rawValue", '') || COALESCE(phone."countryCode", '') || COALESCE(phone."phoneNumber"::text, ''),
               '[^0-9]',
               '',
               'g'
             ),
             ${digits}
           ) > 0
         )
         OR (${customerNumber >= 0} AND customer."customerNumber" = ${customerNumber})
      ORDER BY customer."fullName" ASC NULLS LAST
      LIMIT 12
    `;

    const customers = await prisma.customer.findMany({
      where: { id: { in: matches.map((customer) => customer.id) } },
      select: {
        id: true,
        customerNumber: true,
        fullName: true,
        phones: {
          select: {
            id: true,
            countryCode: true,
            phoneNumber: true,
            kind: true,
            label: true,
            rawValue: true,
            isCommunicationPhone: true,
          },
        },
      },
    });
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    const orderedCustomers = matches
      .map((match) => customersById.get(match.id))
      .filter(Boolean)
      .map((customer) => ({
        ...customer,
        phones: customer.phones.map((phone) => ({
          ...phone,
          phoneNumber: phone.phoneNumber?.toString() || null,
        })),
      }));

    return res.json({ customers: orderedCustomers });
  } catch (error) {
    console.error("Customer search failed", error);
    return res.status(500).json({ message: "No se ha podido buscar pacientes" });
  }
});

router.get("/edit/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await prisma.customer.findUnique({
      where: {
        id
      },
      include:{
        phones: true
      }
    });
    if(!response){
        return res.status(404).json({ message: "Cliente no encontrado" });
    }
    
    const sanitizedResponse = {
        ...response,
        phones: response.phones.map((phone) => ({
          ...phone,
          phoneNumber: phone.phoneNumber?.toString() || null,
        })),
      };
  
      res.json(sanitizedResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/detail/:id", async (req, res) => {
  try {
    const now = new Date();
    const appointmentInclude = {
      practitioner: { select: { id: true, name: true, lastName: true, color: true } },
      user: { select: { id: true, name: true, lastName: true } },

    };
    const [customer, nextAppointment] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: req.params.id },
        include: {
          phones: true,
          docs: {
            where: { status: "ACTIVE" },
            include: { versions: { orderBy: { version: "desc" } } },
            orderBy: { createdAt: "asc" },
          },
          appointments: {
            include: appointmentInclude,
            orderBy: { citaDate: "desc" },
            take: 20,
          },
        },
      }),
      prisma.date.findFirst({
        where: {
          customerId: req.params.id,
          citaDate: { gte: now },
        },
        include: appointmentInclude,
        orderBy: { citaDate: "asc" },
      }),
    ]);

    if (!customer) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }

    return res.json({
      customer: {
        ...customer,
        phones: customer.phones.map((phone) => ({
          ...phone,
          phoneNumber: phone.phoneNumber?.toString() || null,
        })),
      },
      nextAppointment,
    });
  } catch (error) {
    console.error("Customer detail could not be loaded", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/edit", async (req, res)=>{
    try {
        const id = typeof req.body.id === "string" ? req.body.id : "";
        if (!id) {
          return res.status(400).json({ message: "El cliente no es válido" });
        }

        const existingCustomer = await prisma.customer.findUnique({
          where: { id },
          select: { preferredCommunication: true },
        });
        if (!existingCustomer) {
          return res.status(404).json({ message: "Cliente no encontrado" });
        }

        const enabledPreferredCommunications = new Set(
          preferredCommunications.getEnabledChannels()
        );
        if (existingCustomer.preferredCommunication) {
          enabledPreferredCommunications.add(
            existingCustomer.preferredCommunication
          );
        }

        const { customer, phones } = normalizeCustomerInput(req.body, {
          enabledPreferredCommunications,
        });
        const updatedCustomer = await prisma.$transaction(async (transaction) => {
          const updated = await transaction.customer.update({
            where: { id },
            data: customer,
          });

          await transaction.phoneNumber.deleteMany({ where: { customerId: id } });
          if (phones.length) {
            await transaction.phoneNumber.createMany({
              data: phones.map((phone) => ({ ...phone, customerId: id })),
            });
          }

          return updated;
        });

        return res.json({ customer: updatedCustomer });
    } catch (error) {
        if (error instanceof CustomerValidationError) {
          return res.status(400).json({ message: error.message });
        }

        console.error(error);
        return res.status(500).json({ message: "Server error" });
    }
})

router.get("/delete/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const response = await prisma.date.findMany({
            where: {
                customerId: id,
                citaDate: {
                  gte: DateTime.now().setZone("Europe/Madrid").toJSDate()
                }
            },
            orderBy: {
                citaDate: 'asc' 
            }
        });
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

router.delete("/delete/:id", async (req, res) =>{
    const { id } = req.params
    try {
        await prisma.customer.delete({
            where: {
              id: id
            }
          })
    
        return res.status(204).send();
      } catch (error) {
        console.error("Error al eliminar el cliente:", error);
        return res.status(500).json({ message: "Server error" });
      }
})

module.exports = router;
