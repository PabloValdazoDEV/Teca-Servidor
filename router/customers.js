const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const { DateTime } = require("luxon");

router.post("/create", authMiddleware, async (req, res) => {
  console.log(req.body);
  const {
    fullName,
    age,
    weight,
    height,
    PhoneNumber,
    profession,
    province,
    population,
    cD,
    address,
    emailAddress,
    children,
    observationChildren,
    dateBirth,
    preferredCommunication,
  } = req.body;

  const date = DateTime.fromISO(dateBirth, { zone: "Europe/Madrid" }).toJSDate();
  try {
    await prisma.customer.create({
        data: {
            fullName,
            age,
            weight: +weight,
            height: +height,
            profession,
            province,
            population,
            cD: +cD,
            address,
            emailAddress,
            children: +children,
            observationChildren,
            dateBirth: date,
            preferredCommunication,
            phones: {
              createMany: {
                data: PhoneNumber.map((phone) => ({
                  countryCode: phone.countryCode,
                  phoneNumber: BigInt(phone.phoneNumber),
                  isCommunicationPhone: phone.isCommunicationPhone || false,
                })),
              },
            },
          },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/all", authMiddleware, async (req, res) => {
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
          phoneNumber: phone.phoneNumber.toString(), 
        })),
      }));
  
      res.json(sanitizedResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/edit/:id", authMiddleware, async (req, res) => {
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
          phoneNumber: phone.phoneNumber.toString(), 
        })),
      };
  
      res.json(sanitizedResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/edit", authMiddleware, async (req, res)=>{
    const {
        id,
        fullName,
        age,
        PhoneNumber,
        weight,
        height,
        profession,
        province,
        population,
        cD,
        address,
        emailAddress,
        children,
        observationChildren,
        dateBirth,
        preferredCommunication,
      } = req.body;

      const date = DateTime.fromISO(dateBirth, { zone: "Europe/Madrid" }).toJSDate();
    try {
        const response = await prisma.customer.update({
            where:{
                id
            },
            data: {
                fullName,
                age,
                weight: +weight,
                height: +height,
                profession,
                province,
                population,
                cD: +cD,
                address,
                emailAddress,
                children: +children,
                observationChildren,
                dateBirth: date,
                preferredCommunication,
              },
        })

        await prisma.phoneNumber.deleteMany({
            where: {
              customerId: id,
            },
          });
      
          if (PhoneNumber.length > 0) {
            await prisma.phoneNumber.createMany({
              data: PhoneNumber.map((phone) => ({
                customerId: id,
                phoneNumber: BigInt(phone.phoneNumber),
                countryCode: phone.countryCode,
                isCommunicationPhone: phone.isCommunicationPhone || false,
              })),
            });
          }
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
})

router.get("/delete/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    console.log("Get Delete", id);
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

router.delete("/delete/:id", authMiddleware, async (req, res) =>{
    const { id } = req.params
    console.log(id)
    try {
        await prisma.customer.delete({
            where: {
              id: id
            }
          })
    
        console.log("Cliente eliminado con éxito");
      } catch (error) {
        console.error("Error al eliminar el cliente:", error);
        throw new Error("Error eliminando cliente");
      }
})

module.exports = router;
