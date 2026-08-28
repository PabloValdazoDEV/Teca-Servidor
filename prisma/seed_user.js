const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!email || !password) {
        throw new Error(
            "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required"
        );
    }

    if (
        Buffer.byteLength(password, "utf8") > 72 ||
        !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(password)
    ) {
        throw new Error(
            "BOOTSTRAP_ADMIN_PASSWORD must be 8-72 bytes and include upper/lowercase, a number and a symbol"
        );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.upsert({
        where: {
            email,
        },
        update: {},
        create: {
            email,
            name: "Admin",
            lastName: "Administrador",
            password: passwordHash,
            role: "SUPERADMIN",
        },
    });

    console.log("✅ Usuario administrador disponible:");
    console.log({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
    });
}

main()
    .catch((error) => {
        console.error("❌ Error ejecutando seed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
