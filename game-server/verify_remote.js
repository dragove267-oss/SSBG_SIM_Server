const db = require("./database/db.js");
const items = db.prepare("SELECT itemCode, name, itemType, description FROM item_definitions ORDER BY itemCode ASC;").all();
console.log("\n=== 100% KOREAN ITEM DICTIONARY CATALOG ===");
items.forEach(item => {
  console.log(`[${item.itemCode}] [${item.itemType}] ${item.name} - ${item.description}`);
});
console.log("Total Items Seeded:", items.length);
db.close();

