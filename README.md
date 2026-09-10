# Atoshi Bridge DApp

Atoshi 链 ⇄ 以太坊 双向跨链桥，以 WebView 形式嵌入 Atoshi 钱包。

覆盖桥出 / 桥入、五层限流额度预检、跨链状态追踪、地址簿。

---

## 当前状态

| | 状态 | 说明 |
|---|---|---|
| 桥参数（五层限流的配置） | ✅ | REST `/atoshi/bridgeadapter/v1/params` |
| migration_pool 流动性 | ✅ | `module_accounts` + `bank/balances` |
| 五层限流的**上限** | ✅ | 前端照搬链上 `ResolveLimits`，六项逐个对过真链 |
| 五层限流的**今日已用** | ✅ | 从 Blockscout `BridgeOut` 日志重建，按 UTC 日重置 |
| ATOS 余额 | ✅ | `bank/balances` |
| ERC20 ATOS 余额 | ✅ | 以太坊合约调用 |
| **桥入** Ethereum→Atoshi | ✅ | `AtosCollateral.transferRemote` |
| **桥出** Atoshi→Ethereum | ✅ | bridgeadapter EVM 预编译 `0x…0808` |
| 跨链记录 / 状态查询 | ✅ | 记录保存在本机，两条链分别确认到账状态 |

链上原生查询暂未暴露限额的今日已用量，所以 DApp 使用成功交易产生的
`BridgeOut` EVM 事件计算全局、大额和当前地址用量。交易确认后先即时扣减，
Blockscout 完成索引后再自动校准。

---

## 架构：三个数据源

```
        ┌──── Atoshi 读 ──────────┐
页面 ──> Cosmos REST + Blockscout   参数、余额、今日桥出用量

        ┌──── 以太坊读写 ────┐
页面 ──> 钱包签名 ──> Sepolia   ERC20 余额、approve、transferRemote（桥入）

        ┌──── Atoshi 写 ────┐
页面 ──> 钱包签名 ──> 0x…0808   bridgeOut（桥出）
```

### 桥入是两笔交易，不是一笔

```
1. ERC20.approve(collateral, amount)      让金库能来拉币
2. collateral.transferRemote(dest, recipient32, amount)   发起跨链
```

UI 上必须体现成两步，否则用户在第一笔签完之后会以为已经完成了。
代码里第 1 笔会先查 `allowance`，够了就跳过，省用户一笔 gas。

第 2 笔的 `msg.value` 必须付够 `quoteGasPayment(destinationDomain)`。
**付少了不是失败，是永远不到账** —— relayer 不会转发，消息一直挂在
Mailbox 里。比失败难查得多，所以报价是每次现查的，没有写死。

### 两条链，必须切链

桥出的交易发在 Atoshi 上，桥入发在以太坊上。**签错链不会报失败** ——
只是发出一笔发在另一条链上的无意义交易，钱照样花掉。所以 `WalletBar`
会按当前选的方向检查 `chainId`，不对就挡住并给一键切链。

### Hyperlane 的 32 字节地址

收款地址在 Hyperlane 消息里是 **32 字节**，20 字节的 EVM 地址要**左侧**补
12 个零字节（高位补零，和 `abi.encode(address)` 一致）。

右侧补零是个常见错误，结果是钱转给一个不存在的地址，**不可逆**。
`src/wallet/chains.ts` 的 `toHyperlane32Bytes` 负责这个，已用 `cast abi-encode`
交叉验证过。

---

## 五层限流

链上 `x/bridgeadapter/types/ratelimit.go` 的 `CheckOutbound` 按这个顺序检查，
顺序是刻意的 —— 报错要指出真正卡住的那一层，而不是碰巧先检查到的那一层：

| # | 层 | 作用 |
|---|---|---|
| 1 | 单笔下限 | 粉尘转账和大额一样要花一条跨链消息 |
| 2 | 危机模式 | 池子低于 10% 时只放小额，让剩余流动性服务多数小额持有者 |
| 3 | 全局日上限 | 限一天的总流出 |
| 4 | 大额预算 | 全局上限减去小额预留（20%）。**这层最关键** —— 没有它，几笔大额会在开盘几分钟内吃光当日额度，普通持有者正好在最想退出的时候被锁在外面 |
| 5 | 单地址日上限 | 一个地址不能独占当日额度 |

前端 `resolveLimits` 是链上 `ResolveLimits` 的逐行翻版。**改动时必须同步改两边** ——
前端算得比链宽松，用户会提交后被拒；算得比链严格，用户会以为额度不够。

一条容易漏的：全局日上限取「固定参数」和「池子余额 × 5%」的**较小值**，
所以池子缩水时额度自动收紧，不用等治理提案。

实测（测试网，池子满额 3000 亿 ATOS），前端和链上六项完全一致：

```
global_daily_cap 参数    5,000,000,000 ATOS
池子余额 × 5%           15,000,000,000 ATOS
→ 取较小值                5,000,000,000 ATOS
大额预算 (−20%)           4,000,000,000 ATOS
单地址上限 (×2%)            100,000,000 ATOS
小额阈值                        100,000 ATOS
最小单笔                          1,000 ATOS
crisis_mode = false
```

### 「今日已用」的来源

链上确实记着这三个数（`GetRateLimitState` / `GetAddressUsage`），但
`query.proto` 只暴露了 `params` 和 `receipt_state` 两个查询，没导出来。

当前 DApp 从 Blockscout 的 `BridgeOut` 日志重建 UTC 当日全局、大额和当前地址
用量，成功交易拿到回执时还会立即在内存中扣减，避免等待索引延迟。浏览器不可用
时才设置 `BridgeLimits.usage_available = false` 并降级显示每日上限。

修法见下面「已知待办」。

---

## 数据来源：mock 和 chain

```
VITE_API_MODE=mock    模拟数据 + 状态机模拟 + 场景切换
未设置或其它值         连真链（默认）
```

桥的 mock **不是过渡产物，会长期保留**。它模拟了跨链状态机的自动步进和五层限流
的各种边缘场景（`setScenario`：危机模式、大额配额耗尽、单地址耗尽、全局耗尽、
桥暂停、余额不足、等待流动性），是产品评审和 QA 验证 UI 分支的唯一手段 ——
真链上凑不出这些状态。

`SCENARIOS_AVAILABLE` 在 chain 模式下是 `false`，UI 上那个测试面板要隐藏。

> 显式设了 `chain` 却没给 `VITE_REST_URL` 时会**直接抛错**，不静默退回 mock。
> 静默退回会让页面显示一堆假数据而看起来一切正常，是最难排查的一种故障。

---

## 代码结构

```
src/
  services/
    bridgeApi.ts        切换层。UI 只 import 这个
    bridgeApiMock.ts    模拟数据 + 跨链状态机 + 场景切换
    bridgeApiChain.ts   真链实现；文件头有一张能力表
    chainRest.ts        Atoshi REST 客户端、单位换算
  wallet/
    chains.ts           Atoshi + Sepolia 定义、bech32↔hex、Hyperlane 32 字节
    config.ts           wagmi 配置（两条链，injected connector）
    contracts.ts        ERC20 + Hyperlane TokenRouter ABI、地址、gas 上限
    useWallet.ts        账户 + 按方向判断链对不对
    WalletProvider.tsx  包在 App 外面
  components/
    Header.tsx          顶部导航 + 方向切换
    WalletBar.tsx       连接 / 切链 / 错误提示
    BridgeOutView.tsx   桥出表单
    BridgeInView.tsx    桥入表单
    QuotaPanel.tsx      五层额度面板
    TransactionModal.tsx 跨链状态机进度
    HistoryDrawer.tsx   历史记录
  utils/bridgeValidation.ts  地址校验、整除判断、32 字节转换
```

### 单位与精度

- Atoshi 最小单位 **liao**，1 ATOS = 10^18 liao
- REST 返回的都是 liao 的整数字符串
- **服务层对外用 ATOS（number）**，换算集中在 `chainRest.ts`

为什么 number 是安全的：除以 10^18 之后最大值是 3000 亿（3e11），远在 Number
的精确范围（2^53 ≈ 9e15）之内。

**但有两处绝对不能用浮点**：

1. `atosToLiao` —— 交易金额要精确到 liao，`atos * 1e18` 会引入误差
2. **整除判断** —— 链上按 `liao % atos_per_erc20` 判断，不是要求用户输入
   100 ATOS 的整数倍。当前参数下真实粒度是 100 liao（`1e-16 ATOS`）。

---

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000
```

默认连接真链。需要演示模式时显式设置 `VITE_API_MODE=mock`；该模式不需要节点或钱包。

```bash
npm run build        # 产物在 dist/，纯静态
npm run preview
```

环境变量是**构建期**注入的（Vite 的 `import.meta.env`），不是运行期读的 ——
改了 `.env` 必须重新 `npm run build`，改服务器上 `dist/` 里的文件没有用。

nginx 部署和质押页一样，`try_files $uri $uri/ /index.html;` 那行必须有，
否则刷新页面 404。

---

## 已知待办

按优先级：

1. **链侧加一个 Limits 查询**，直接暴露今日已用量。
   `x/bridgeadapter/keeper` 里 `GetRateLimitState` / `GetAddressUsage` /
   `Limits(ctx)` 都有了，只差在 `query.proto` 加一个 rpc 和一个
   `google.api.http` 注解，再把 `Querier` 实现补上。DApp 目前通过浏览器事件重建
   剩余额度，但链上原生查询仍更可靠，也能去掉对索引延迟和可用性的依赖。

2. **后端索引服务**，实现跨设备同步的跨链记录。完整记录天然需要两条链的数据
   （Atoshi 侧的 bridge_out 事件 + 以太坊侧 Mailbox 的 Dispatch/Process 事件），
   `getBridgeHistory` 目前返回空列表，当前页面只保存本浏览器发起的记录。
   注意别拿 `receipt_state` 去顶 —— 那是 tier 释放通道的回执状态，
   不是资产桥的转账记录，两个不是一回事。

---

## 视觉约定

白底、浅灰分隔线、圆角卡片、移动端竖屏优先（375–430px），无深色模式 ——
与钱包内其他页面（如隐私交易、质押）保持一致。金额用等宽数字字体。
