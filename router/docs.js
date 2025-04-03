const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");



router.get("/ficha/:docId", authMiddleware, async (req, res) => {
  const { docId } = req.params;
  try {
    const customerId = await prisma.doc.findUnique({
      where:{
        id: docId
      },
      select:{
        customerId:true
      }
    })
    const customer = await prisma.customer.findMany({
      where: {
        id: customerId.customerId
      },
      include: {
        appointments: {
          where: {
            Ficha: {
              none: {} 
            }
          },
          orderBy: {
            citaDate: "desc"
          },
          include: {
            Ficha: true 
          }
        }
      }
    });
    // console.log(customer)
    const response = await prisma.ficha.findMany({
      where: {
        docId,
      },
      include:{
        bodyAssessments:true,
        date:true
      },
      orderBy:{
        date:{
          citaDate: "desc"
        }
      }
    });
    // console.log(response)
    res.json({"fichas": response, "customer": customer[0], docId: docId});
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:customerId", authMiddleware, async (req, res) => {
  const { customerId } = req.params;
  // const { typeDoc, fixedType } = req.body;
  try {
    await prisma.doc.create({
      data: {
        typeDoc: "OTRO",
        fixedType: "FICHA",
        customerId,
      },
    });
    res.send("Documeto Creada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/ficha/:docId", authMiddleware, async (req, res) => {
  // console.log(req.body)
  const { docId } = req.params;
  // console.log(docId)
  const { observations, treatmentPlan, dateFichaId, bodyAssessments } = req.body;
  try {
    await prisma.ficha.create({
      data: {
        docId: docId,
        observations: observations,
        treatmentPlan: treatmentPlan,
        dateFichaId: dateFichaId,
        bodyAssessments: {
          createMany: {
            data: bodyAssessments,
          },
        },
      },
    });
    res.send("Ficha Creada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/ficha/:fichaId", authMiddleware, async (req, res) => {
  const { fichaId } = req.params;
  const { observations, treatmentPlan, dateFichaId, bodyAssessments } = req.body;

  // console.log(req.body)
  try {

    await prisma.bodyPartAssessment.deleteMany({
      where: { fichaId: fichaId }
    });
    

    await prisma.ficha.update({
      where: { id: fichaId },
      data: {
        observations: observations,
        treatmentPlan: treatmentPlan,
        dateFichaId: dateFichaId,
        bodyAssessments: {
          createMany: {
            data: bodyAssessments,
          },
        },
      },
    });
    
    res.send("ficha actualizada");
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/ficha/:fichaId", authMiddleware, async(req, res)=> {
  const { fichaId } = req.params
  try {
    await prisma.ficha.delete({
      where:{
        id: fichaId
      }
    })
    res.send("ficha eliminada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
})

router.delete("/:docId", authMiddleware, async(req, res)=> {
  const { docId } = req.params
  try {
    await prisma.doc.delete({
      where:{
        id: docId
      }
    })
    res.send("Documento eliminado")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
})

router.get("/:customerId", authMiddleware, async (req, res) => {
  const { customerId } = req.params;
  try {
    const response = await prisma.doc.findMany({
      where: {
        customerId,
        // Fichas:{
        //   some: {}
        // }
      },
      include:{
        customer: true,
      }
    });
    // console.log(response)
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
