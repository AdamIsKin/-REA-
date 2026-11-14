-- 003_item_master：商品主数据重构（设计文档 D47 / R23 / R28）。
-- 新增面向门店的字段；serial_type 取代「全强制串号」；分类/品牌仍用既有主数据表。

ALTER TABLE item ADD COLUMN series TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN memory1 TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN memory2 TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN version TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN supplier_id INTEGER REFERENCES partner (id);
ALTER TABLE item ADD COLUMN serial_type TEXT NOT NULL DEFAULT 'single'
  CHECK (serial_type IN ('none', 'single', 'dual'));
ALTER TABLE item ADD COLUMN stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0);
ALTER TABLE item ADD COLUMN stock_max INTEGER NOT NULL DEFAULT 0 CHECK (stock_max >= 0);
ALTER TABLE item ADD COLUMN is_consignment INTEGER NOT NULL DEFAULT 0 CHECK (is_consignment IN (0, 1));
ALTER TABLE item ADD COLUMN is_quotable INTEGER NOT NULL DEFAULT 1 CHECK (is_quotable IN (0, 1));
ALTER TABLE item ADD COLUMN created_by INTEGER REFERENCES user (id);
ALTER TABLE item ADD COLUMN updated_by INTEGER REFERENCES user (id);

-- 历史：原 serial_managed=1 → single，否则 none；dual 仅新录入可选。
UPDATE item SET serial_type = CASE WHEN serial_managed = 1 THEN 'single' ELSE 'none' END;

-- 已有行补录入人（若库中尚无用户则保持 NULL，首次保存商品时由程序写入）。
UPDATE item
SET created_by = (SELECT id FROM user ORDER BY id LIMIT 1),
    updated_by = (SELECT id FROM user ORDER BY id LIMIT 1)
WHERE created_by IS NULL AND EXISTS (SELECT 1 FROM user LIMIT 1);
