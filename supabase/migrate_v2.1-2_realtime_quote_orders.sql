-- ============================================================
-- V2.1-2 增量脚本：让「报价单」支持实时回传（经销商等销售确认）
--
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query
--       → 整段粘贴进来 → Run（或 Cmd/Ctrl + Enter）
--
-- 不做这一步的后果：经销商页的 Realtime 订阅收不到任何事件，
-- 而且**不报错**——页面表现是「销售点了确认，经销商这边就是不刷新」，
-- 是最难排查的一类故障。功能本身有兜底（回到页面 / 手动刷新会读到最新状态），
-- 但想做到「秒级回传」就必须执行本脚本。
--
-- 脚本幂等，重复执行不会有副作用。
-- ============================================================

-- 0) 先补两个确认留痕字段（V2.1-2 新增：谁在什么时候确认的）
--    不跑这一步也能用：代码会降级成「只改状态」，确认照样生效，只是查不到确认人。
ALTER TABLE "quoteOrders" ADD COLUMN IF NOT EXISTS "confirmedBy" integer;
ALTER TABLE "quoteOrders" ADD COLUMN IF NOT EXISTS "confirmedAt" timestamptz;

-- 1) 把 quoteOrders 加入 Realtime 发布（缺这一步，任何订阅都收不到事件）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quoteOrders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "quoteOrders";
  END IF;
END $$;

-- 2) Realtime 的过滤条件（customerId=eq.<id>）要能算到「变更前」那一行的值，
--    否则 UPDATE / DELETE 事件会因无法判定过滤条件而被整条丢掉。
--    默认只记主键，这里改成整行都记。
ALTER TABLE "quoteOrders" REPLICA IDENTITY FULL;

-- 3) 校验：两条都应返回结果
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quoteOrders';

SELECT relname, relreplident FROM pg_class WHERE relname = 'quoteOrders';
-- relreplident 应为 'f'（full）
