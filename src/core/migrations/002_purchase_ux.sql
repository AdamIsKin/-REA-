-- 002_purchase_ux：采购入库 UX（设计文档 D39–D42 / R23–R26）。
-- 分类与品牌主数据；商品改外键；全串号；单据行返利预留字段。

CREATE TABLE item_category (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT    NOT NULL
) STRICT;

CREATE TABLE item_brand (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT    NOT NULL
) STRICT;

-- 把旧文本分类/品牌迁成主数据（空串不建）。
INSERT INTO item_category (code, name, enabled, created_at)
SELECT printf('C%04d', ROW_NUMBER() OVER (ORDER BY category)), category, 1, datetime('now')
FROM (SELECT DISTINCT category FROM item WHERE category IS NOT NULL AND TRIM(category) <> '');

INSERT INTO item_brand (code, name, enabled, created_at)
SELECT printf('B%04d', ROW_NUMBER() OVER (ORDER BY brand)), brand, 1, datetime('now')
FROM (SELECT DISTINCT brand FROM item WHERE brand IS NOT NULL AND TRIM(brand) <> '');

ALTER TABLE item ADD COLUMN category_id INTEGER REFERENCES item_category (id);
ALTER TABLE item ADD COLUMN brand_id INTEGER REFERENCES item_brand (id);

UPDATE item SET category_id = (SELECT id FROM item_category c WHERE c.name = item.category)
WHERE category IS NOT NULL AND TRIM(category) <> '';
UPDATE item SET brand_id = (SELECT id FROM item_brand b WHERE b.name = item.brand)
WHERE brand IS NOT NULL AND TRIM(brand) <> '';

-- SQLite 3.35+：删除已被外键取代的文本列。
ALTER TABLE item DROP COLUMN category;
ALTER TABLE item DROP COLUMN brand;

-- R23：全部商品按串号管理。
UPDATE item SET serial_managed = 1;

-- R26：返利预留（分），不进成本引擎。
ALTER TABLE doc_line ADD COLUMN rebate_per_unit INTEGER NOT NULL DEFAULT 0 CHECK (rebate_per_unit >= 0);
ALTER TABLE doc_line ADD COLUMN rebate_amount INTEGER NOT NULL DEFAULT 0 CHECK (rebate_amount >= 0);
