-- 001_init：第一版完整表结构（设计文档第 6 节）。
-- 约定：所有表 STRICT（SQLite 强制列类型）；金额 INTEGER 分，数量 INTEGER 件；
--       业务日期 TEXT 'YYYY-MM-DD'，记录时间 TEXT ISO 8601；布尔 INTEGER 0/1。
-- 已发布的迁移文件禁止修改，只能新增 002_xxx.sql（设计文档 11.1）。

-- ═════════════════════════════ 基础资料 ═════════════════════════════

CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  display_name  TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('owner', 'clerk')),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    TEXT    NOT NULL
) STRICT;

-- 字段参考原系统 store_maintain（store_no / store_name / comments）。
CREATE TABLE warehouse (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  remark     TEXT    NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT    NOT NULL
) STRICT;

-- 字段参考原系统 item_master（item_no / item_name / item_spec / unit / bar_code /
-- def_inprice / def_outprice / item_type / brand / comments）。
-- 原系统的 quantity 列是否被维护未知（未知项 unk_7144…），新系统不在商品表存库存，库存只看 stock_balance。
CREATE TABLE item (
  id                 INTEGER PRIMARY KEY,
  code               TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL,
  spec               TEXT    NOT NULL DEFAULT '',
  unit               TEXT    NOT NULL DEFAULT '件',
  barcode            TEXT,
  category           TEXT    NOT NULL DEFAULT '',
  brand              TEXT    NOT NULL DEFAULT '',
  serial_managed     INTEGER NOT NULL CHECK (serial_managed IN (0, 1)),
  default_buy_price  INTEGER NOT NULL DEFAULT 0 CHECK (default_buy_price >= 0),
  default_sell_price INTEGER NOT NULL DEFAULT 0 CHECK (default_sell_price >= 0),
  remark             TEXT    NOT NULL DEFAULT '',
  enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
) STRICT;
-- 部分唯一索引：条码可以为空，但不为空时必须唯一（多个 NULL 不冲突）。
CREATE UNIQUE INDEX ux_item_barcode ON item (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE partner (
  id         INTEGER PRIMARY KEY,
  kind       TEXT    NOT NULL CHECK (kind IN ('supplier', 'customer')),
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  contact    TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  address    TEXT    NOT NULL DEFAULT '',
  remark     TEXT    NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT    NOT NULL,
  UNIQUE (kind, code)
) STRICT;

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- ═════════════════════════════ 单据 ═════════════════════════════

CREATE TABLE doc (
  id              INTEGER PRIMARY KEY,
  doc_no          TEXT    NOT NULL UNIQUE,
  doc_type        TEXT    NOT NULL CHECK (doc_type IN ('PURCHASE', 'SALE', 'TRANSFER', 'PURCHASE_RETURN', 'SALE_RETURN')),
  biz_date        TEXT    NOT NULL CHECK (biz_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouse (id),
  to_warehouse_id INTEGER REFERENCES warehouse (id),
  partner_id      INTEGER REFERENCES partner (id),
  ref_doc_id      INTEGER REFERENCES doc (id),
  status          TEXT    NOT NULL CHECK (status IN ('draft', 'posted')),
  remark          TEXT    NOT NULL DEFAULT '',
  created_by      INTEGER NOT NULL REFERENCES user (id),
  updated_by      INTEGER NOT NULL REFERENCES user (id),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  posted_at       TEXT,
  -- 两组“当且仅当”约束（设计文档 6.3），在数据库层兜底，防止程序错误写出不一致的单据头。
  CHECK ((doc_type = 'TRANSFER') = (to_warehouse_id IS NOT NULL)),
  CHECK (to_warehouse_id IS NULL OR to_warehouse_id <> warehouse_id),
  CHECK ((doc_type IN ('PURCHASE_RETURN', 'SALE_RETURN')) = (ref_doc_id IS NOT NULL)),
  CHECK ((doc_type = 'TRANSFER') = (partner_id IS NULL))
) STRICT;
CREATE INDEX ix_doc_type_date ON doc (doc_type, biz_date, id);
CREATE INDEX ix_doc_date ON doc (biz_date, id);
-- 部分索引：只有退货单有 ref_doc_id，用于“原单是否被引用”（R19）的快速判断。
CREATE INDEX ix_doc_ref ON doc (ref_doc_id) WHERE ref_doc_id IS NOT NULL;

CREATE TABLE doc_line (
  id          INTEGER PRIMARY KEY,
  doc_id      INTEGER NOT NULL REFERENCES doc (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  item_id     INTEGER NOT NULL REFERENCES item (id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_price  INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount      INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  ref_line_id INTEGER REFERENCES doc_line (id),
  -- 只能由成本引擎写入（设计文档 11.1）。
  cost_amount INTEGER NOT NULL DEFAULT 0,
  remark      TEXT    NOT NULL DEFAULT '',
  UNIQUE (doc_id, line_no)
) STRICT;
CREATE INDEX ix_doc_line_item ON doc_line (item_id);
CREATE INDEX ix_doc_line_ref ON doc_line (ref_line_id) WHERE ref_line_id IS NOT NULL;

CREATE TABLE doc_line_serial (
  line_id INTEGER NOT NULL REFERENCES doc_line (id) ON DELETE CASCADE,
  serial  TEXT    NOT NULL,
  PRIMARY KEY (line_id, serial)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_doc_line_serial_serial ON doc_line_serial (serial);

-- 单号流水：前缀 + 创建日期 → 当日最后一个序号。
CREATE TABLE doc_seq (
  prefix  TEXT    NOT NULL,
  day     TEXT    NOT NULL,
  last_no INTEGER NOT NULL,
  PRIMARY KEY (prefix, day)
) STRICT, WITHOUT ROWID;

-- ═════════════════════════════ 库存账 ═════════════════════════════

-- 库存流水：只能由过账写入。排序键 key = (biz_date, doc_id, line_id)。
CREATE TABLE stock_move (
  id           INTEGER PRIMARY KEY,
  doc_id       INTEGER NOT NULL REFERENCES doc (id),
  line_id      INTEGER NOT NULL REFERENCES doc_line (id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES item (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse (id),
  biz_date     TEXT    NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty <> 0)
) STRICT;
-- 时间线检查（7.5）按“仓库 + 商品”扫描并按 key 排序，此索引同时覆盖过滤和排序，避免临时排序。
CREATE INDEX ix_stock_move_wh_item_key ON stock_move (warehouse_id, item_id, biz_date, doc_id, line_id);
-- 商品维度的流水查询与“是否已有流水”（锁定串号标志）判断。
CREATE INDEX ix_stock_move_item_key ON stock_move (item_id, biz_date, doc_id, line_id);
CREATE INDEX ix_stock_move_doc ON stock_move (doc_id);

-- 库存结存：查询直接读这里，不再汇总历史（改进原系统 v_store_inout 的全表汇总）。
CREATE TABLE stock_balance (
  warehouse_id INTEGER NOT NULL REFERENCES warehouse (id),
  item_id      INTEGER NOT NULL REFERENCES item (id),
  -- 不出现负库存的最后一道保险；正常情况下时间线检查已先拦下。
  qty          INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (warehouse_id, item_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_stock_balance_item ON stock_balance (item_id);

-- 串号流水：对应原系统 v_store_inout_code 的 +1 / −1 思路，但带上排序键，支持“某天串号在哪个仓库”。
CREATE TABLE serial_move (
  id           INTEGER PRIMARY KEY,
  serial       TEXT    NOT NULL,
  item_id      INTEGER NOT NULL REFERENCES item (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse (id),
  biz_date     TEXT    NOT NULL,
  doc_id       INTEGER NOT NULL REFERENCES doc (id),
  line_id      INTEGER NOT NULL REFERENCES doc_line (id) ON DELETE CASCADE,
  delta        INTEGER NOT NULL CHECK (delta IN (-1, 1))
) STRICT;
CREATE INDEX ix_serial_move_key ON serial_move (serial, biz_date, doc_id, line_id);
CREATE INDEX ix_serial_move_doc ON serial_move (doc_id);

-- ═════════════════════════════ 成本 ═════════════════════════════

-- 成本批次：手机每个串号一个 qty=1 的批次；配件一个入库行一个批次（D23）。
CREATE TABLE cost_layer (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES item (id),
  source_line_id INTEGER NOT NULL REFERENCES doc_line (id) ON DELETE CASCADE,
  serial         TEXT,
  biz_date       TEXT    NOT NULL,
  doc_id         INTEGER NOT NULL REFERENCES doc (id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  amount         INTEGER NOT NULL,
  -- 第二版价保、返利；有效金额 = amount − adj_amount（8.6）。
  adj_amount     INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX ix_cost_layer_item_key ON cost_layer (item_id, biz_date, doc_id, source_line_id);
CREATE INDEX ix_cost_layer_item_serial ON cost_layer (item_id, serial) WHERE serial IS NOT NULL;
CREATE INDEX ix_cost_layer_source ON cost_layer (source_line_id);

-- 出库行与批次的分配关系：只能由成本引擎写入。
CREATE TABLE cost_alloc (
  line_id  INTEGER NOT NULL REFERENCES doc_line (id) ON DELETE CASCADE,
  layer_id INTEGER NOT NULL REFERENCES cost_layer (id) ON DELETE CASCADE,
  qty      INTEGER NOT NULL CHECK (qty > 0),
  amount   INTEGER NOT NULL,
  PRIMARY KEY (line_id, layer_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_cost_alloc_layer ON cost_alloc (layer_id);

-- ═════════════════════════════ 日志 ═════════════════════════════

CREATE TABLE op_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES user (id),
  action     TEXT    NOT NULL,
  doc_id     INTEGER,
  detail     TEXT    NOT NULL DEFAULT '{}',
  created_at TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_op_log_created ON op_log (created_at);
CREATE INDEX ix_op_log_doc ON op_log (doc_id) WHERE doc_id IS NOT NULL;

CREATE TABLE cost_change_log (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES item (id),
  from_biz_date  TEXT    NOT NULL,
  from_doc_id    INTEGER NOT NULL,
  reason         TEXT    NOT NULL,
  cogs_delta     INTEGER NOT NULL,
  variance_delta INTEGER NOT NULL,
  user_id        INTEGER REFERENCES user (id),
  created_at     TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_cost_change_log_item ON cost_change_log (item_id, created_at);
