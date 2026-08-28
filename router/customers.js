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

router.use(authMiddleware);

router.post("/create", async (req, res) => {
  try {
    const { customer, phones } = normalizeCustomerInput(req.body);
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
  const { page = 1, name, phone } = req.query;
  const salto = 10 * (page - 1);

  try {
    const response = await prisma.customer.findMany({
      where: {
        AND: [
          name
            ? {
                fullName: {
                  contains: name,
                  mode: "insensitive",
                },
              }
            : {},
        ],
      },
      include:{
        phones: true
      },
      skip: salto,
      take: 10,
      orderBy: {
        fullName: "asc",
      },
    });

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
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        phones: true,
        docs: {
          where: { status: "ACTIVE" },
          include: { versions: { orderBy: { version: "desc" } } },
          orderBy: { createdAt: "asc" },
        },
        appointments: {
          include: {
            practitioner: { select: { id: true, name: true, lastName: true, color: true } },
            user: { select: { id: true, name: true, lastName: true } },
          },
          orderBy: { citaDate: "desc" },
          take: 20,
        },
      },
    });

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

        const { customer, phones } = normalizeCustomerInput(req.body);
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
