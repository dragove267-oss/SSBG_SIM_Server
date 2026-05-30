// 기존 DB의 item_definition_options 테이블에서 꿈상점 버그로 인해 오염된 전역 옵션을 청소하고,
// 모든 아이템(Hat, Clothes, Bag, Theme, Friend)의 올바른 고정 옵션만 남기도록 재생성하는 마이그레이션 스크립트.
// 실행: node migrate_clean_definition_options.js

const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database", "game.db"));

console.log("[Migration] 전역 아이템 옵션 정의(item_definition_options) 청소 및 복구 시작...\n");

const expectedOptions = [
  // 1. 모자 (Hat - Academic)
  { itemCode: "100", optionCode: "CURRENCY_ACADEMIC_RATE", value: 1.0 },
  { itemCode: "101", optionCode: "CURRENCY_ACADEMIC_RATE", value: 1.1 },
  { itemCode: "102", optionCode: "CURRENCY_ACADEMIC_RATE", value: 1.2 },
  { itemCode: "103", optionCode: "CURRENCY_ACADEMIC_RATE", value: 1.3 },
  { itemCode: "104", optionCode: "CURRENCY_ACADEMIC_RATE", value: 1.5 },

  // 2. 옷 (Clothes - Extra)
  { itemCode: "200", optionCode: "CURRENCY_EXTRA_RATE", value: 1.0 },
  { itemCode: "201", optionCode: "CURRENCY_EXTRA_RATE", value: 1.1 },
  { itemCode: "202", optionCode: "CURRENCY_EXTRA_RATE", value: 1.2 },
  { itemCode: "203", optionCode: "CURRENCY_EXTRA_RATE", value: 1.3 },
  { itemCode: "204", optionCode: "CURRENCY_EXTRA_RATE", value: 1.5 },

  // 3. 가방 (Bag - Idle)
  { itemCode: "300", optionCode: "CURRENCY_IDLE_RATE", value: 1.0 },
  { itemCode: "301", optionCode: "CURRENCY_IDLE_RATE", value: 1.1 },
  { itemCode: "302", optionCode: "CURRENCY_IDLE_RATE", value: 1.2 },
  { itemCode: "303", optionCode: "CURRENCY_IDLE_RATE", value: 1.3 },
  { itemCode: "304", optionCode: "CURRENCY_IDLE_RATE", value: 1.5 },

  // 4. 가구 (Theme - EXP 고정)
  { itemCode: "400", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "401", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "402", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "403", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "404", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "405", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "406", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "407", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "408", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },
  { itemCode: "409", optionCode: "CURRENCY_EXP_FLAT", value: 50.0 },

  // 5. 프랜즈 (Friend - 각 전용 고정 옵션)
  { itemCode: "500", optionCode: "CURRENCY_ACADEMIC_RATE", value: 2.0 },
  { itemCode: "501", optionCode: "CURRENCY_EXTRA_RATE", value: 2.0 },
  { itemCode: "502", optionCode: "CURRENCY_IDLE_RATE", value: 2.0 },
];

try {
  db.exec("PRAGMA foreign_keys = OFF;");
  
  // 기존 전역 옵션 완전 청소
  db.exec("DELETE FROM item_definition_options;");
  console.log("[1/2] 기존 item_definition_options 레코드 초기화 완료");

  // 새로운 클린 마스터 데이터 삽입
  const insert = db.prepare(`
    INSERT INTO item_definition_options (itemCode, optionCode, value)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const opt of expectedOptions) {
      insert.run(opt.itemCode, opt.optionCode, opt.value);
    }
  });
  
  tx();
  console.log(`[2/2] 클린 마스터 옵션 정의 총 ${expectedOptions.length}개 복구 완료`);
  
  db.exec("PRAGMA foreign_keys = ON;");
  
  console.log("\n[완료] 전역 아이템 옵션 정의 청소 및 마이그레이션이 성공적으로 완료되었습니다!");
} catch (err) {
  console.error("\n[오류] 마이그레이션 중 오류가 발생했습니다:", err.message);
} finally {
  db.close();
}
