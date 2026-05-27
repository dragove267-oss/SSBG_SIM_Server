const db = require("./database/db.js");
console.log("Shop count:", db.prepare("SELECT COUNT(*) as count FROM shop_definitions").get().count);
console.log("Craft count:", db.prepare("SELECT COUNT(*) as count FROM craft_definitions").get().count);
console.log("Friend count:", db.prepare("SELECT COUNT(*) as count FROM item_definitions WHERE itemType = 'Friend'").get().count);
db.close();
