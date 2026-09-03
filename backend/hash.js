const bcrypt = require("bcrypt");

async function main() {
    const hash = await bcrypt.hash("1234", 12);
    console.log(hash);
}

main();