const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { faker } = require("@faker-js/faker");

async function main() {
  await prisma.user.deleteMany({
    where: {
      NOT: {
        id: "360d6f38-d6be-4117-824f-fef29e7c3f07",
      },
    },
  });
  await prisma.doc.deleteMany();
  await prisma.customer.deleteMany();

  const dataProvince = [
    "ALAVA",
    "ALBACETE",
    "ALICANTE",
    "ALMERIA",
    "ASTURIAS",
    "AVILA",
    "BADAJOZ",
    "BARCELONA",
    "BURGOS",
    "CACERES",
    "CADIZ",
    "CANTABRIA",
    "CASTELLON",
    "CIUDAD_REAL",
    "CORDOBA",
    "LA_CORUNA",
    "CUENCA",
    "GERONA",
    "GRANADA",
    "GUADALAJARA",
    "GUIPUZCOA",
    "HUELVA",
    "HUESCA",
    "ISLAS_BALEARES",
    "JAEN",
    "LEON",
    "LERIDA",
    "LUGO",
    "MADRID",
    "MALAGA",
    "MURCIA",
    "NAVARRA",
    "ORENSE",
    "PALENCIA",
    "LAS_PALMAS",
    "PONTEVEDRA",
    "LA_RIOJA",
    "SALAMANCA",
    "SEGOVIA",
    "SEVILLA",
    "SORIA",
    "TARRAGONA",
    "SANTA_CRUZ_DE_TENERIFE",
    "TERUEL",
    "TOLEDO",
    "VALENCIA",
    "VALLADOLID",
    "VIZCAYA",
    "ZAMORA",
    "ZARAGOZA",
  ];

  const randomProvince = () => {
    const random = Math.floor(Math.random() * dataProvince.length);
    return dataProvince[random];
  };

  const getAge = (dateBirth) => {
    const today = new Date();
    const birthDate = new Date(dateBirth);
    const age = today.getFullYear() - birthDate.getFullYear();

    const monthDiff = today.getMonth() - birthDate.getMonth();
    const dayDiff = today.getDate() - birthDate.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      return age - 1;
    }

    return age;
  };

  const preferredComunicate = () => {
      const preferredValues = ["WHATSAPP", "SMS", "EMAIL", "PHONE"];
    return preferredValues[Math.floor(Math.random() * preferredValues.length)];
  };

  const dataFakerUser = [];
  const dataFakerCustomer = [];
  const dataFakerDoc = [];

  const numberRandomUser = 5;
  const numberRandomCustomer = 20;

  for (i = 0; i < numberRandomUser; i++) {
    const data = {
      email: faker.internet.email(),
      password: faker.internet.password(),
      name: faker.company.name(),
      lastName: faker.person.lastName(),
    };
    dataFakerUser.push(data);
  }

  await prisma.user.createMany({
    data: dataFakerUser,
    skipDuplicates: true,
  });

  for (i = 0; i < numberRandomCustomer; i++) {
    const phoneFake = faker.number.int({ min: 60000000, max: 70000000 });
    const ageFaker = faker.date.birthdate().toLocaleDateString("es-ES");
    const dateBirthFaker = faker.date
      .birthdate({ min: 18, max: 100, mode: "age" })
      .toISOString();

    const data = {
      id: faker.string.uuid(),
      fullName: faker.person.fullName(),
      age: getAge(ageFaker) || faker.number.int({ min: 10, max: 100 }),
      phone: [phoneFake, faker.number.int({ min: 60000000, max: 70000000 })],
      communicationPhone:
        phoneFake || faker.number.int({ min: 60000000, max: 70000000 }),
      weight: faker.number.int({ min: 10, max: 100 }),
      height: faker.number.int({ min: 150, max: 200 }),
      profession: faker.person.jobTitle(),
      province: randomProvince() || dataProvince[9],
      population: faker.location.city(),
      cD: +faker.location.zipCode("#####"),
      address: faker.location.streetAddress(),
      emailAddress: faker.internet.email(),
      children: faker.number.int({ min: 0, max: 3 }),
      observationChildren: "",
      dateBirth: dateBirthFaker,
      preferredCommunication: preferredComunicate(),
    };

    const dataDoc = {
      customerId: data.id,
      file: faker.image.url(),
      fileName: faker.system.fileName(),
    };

    dataFakerCustomer.push(data);
    dataFakerDoc.push(dataDoc);
  }

  console.log(`User creados correctamente`);

  await prisma.customer.createMany({
    data: dataFakerCustomer,
    skipDuplicates: true,
  });
  console.log(`Customer creados correctamente`);

  await prisma.doc.createMany({
    data: dataFakerDoc,
    skipDuplicates: true,
  });
  console.log(`Doc creados correctamente`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
