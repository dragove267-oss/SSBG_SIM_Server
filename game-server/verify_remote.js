const db = require("./database/db.js");
const items = db.prepare("SELECT itemCode, name, itemType FROM item_definitions LIMIT 15;").all();
console.log("Remote Items in DB:", items);
db.close();
