-- 已有库执行一次：为仓储表增加「区域」字段
ALTER TABLE warehouse ADD COLUMN region VARCHAR(32) NULL AFTER month;
