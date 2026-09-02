# Atoshi Bridge DApp

Atoshi 链 ⇄ 以太坊 双向跨链桥，以 WebView 形式嵌入 Atoshi 钱包。

覆盖桥出 / 桥入、五层限流额度预检、跨链状态追踪、地址簿。

---

## ⚠️ 当前状态：桥入可用，桥出不可用

先看这张表再看代码。桥和质押页处境完全不同 —— 质押是全部接通，桥是一半接不通，
而卡点都不在前端。

| | 状态 | 说明 |
|---|---|---|
| 桥参数（五层限流的配置） | ✅ | REST `/atoshi/bridgeadapter/v1/params` |
| migration_pool 流动性 | ✅ | `module_accounts` + `bank/balances` |
| 五层限流的**上限** | ✅ | 前端照搬链上 `ResolveLimits`，六项逐个对过真链 |
| 五层限流的**今日已用** | ❌ | 链上有数据，`query.proto` 没暴露查询 |
| ATOS 余额 | ✅ | `bank/balances` |
| ERC20 ATOS 余额 | ⚠️ | 以太坊合约调用，**合约未部署** |
| **桥入** Ethereum→Atoshi | ⚠️ | 是以太坊交易，钱包能签，**合约未部署** |
| **桥出** Atoshi→Ethereum | ❌ | **硬阻塞**，见下 |
| 跨链记录 / 状态查询 | ❌ | 无查询接口，需要后端索引服务 |

另外链上 `bridge_enabled` 目前是 `false`，`mailbox_id` / `remote_bridge_vault`
都是 null —— 桥还没通过治理提案启用，所以即便前端全接通了也不会真的转账。

### 桥出为什么还不能用

链上的 `MsgBridgeOut` 是一条 **Cosmos 消息**，而：

- 链上**没有** bridgeadapter 的 EVM 预编译。`atoshid q evm params` 里
  `active_static_precompiles` 只有官方那几个（`0x…0800` staking、
  `0x…0801` distribution、bank、gov、ics20、bech32、p256、vesting），
  所以 `MsgBridgeOut` 变不成一笔以太坊交易。
- Atoshi 钱包原生层只实现了 `eth_*` / `wallet_*` 方法（见安卓端
  `WebAppInterface.kt` 的方法白名单），**没有 Cosmos 签名能力**。

对比一下质押页：它能用 MetaMask 这类 EVM 钱包，正是因为链上开了 staking 预编译。
桥出缺的就是这一环。

两条出路，都在前端之外：

**A. 链侧加一个 bridgeadapter 预编译**（推荐）
和 staking 预编译同一个套路，暴露 `bridgeOut(address sender, bytes32 recipient,
uint256 amount)`。做完之后前端改动很小 —— 照 `stakingApiChain` 的写法调一下就行，
而且所有 EVM 钱包立刻都能用。

**B. 钱包侧支持 Cosmos 签名**
在 `dapp_provider.js` 加一个自定义方法（比如 `atoshi_signAndBroadcastCosmos`），
原生层用 Cosmos SDK 签名并广播。范围更大，而且只有 Atoshi 自己的钱包能用，
MetaMask / OKX 里打开就还是不能桥出。

现在 `submitBridgeOut` 会**抛出说明缺什么的错误**，不返回假的 `tx_hash` ——
桥出涉及真金白银，假成功会让用户以为钱在路上，然后去等一笔不存在的到账。

---

## 架构：三个数据源

```
        ┌──── Atoshi 读 ────┐
页面 ──> Cosmos REST (1317)   桥参数、migration_pool、ATOS 余额

        ┌──── 以太坊读写 ────┐
页面 ──> 钱包签名 ──> Sepolia   ERC20 余额、approve、transferRemote（桥入）

        ┌──── Atoshi 写 ────┐
页面 ──✗ 桥出：缺预编译，见上
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

### 「今日已用」拿不到

链上确实记着这三个数（`GetRateLimitState` / `GetAddressUsage`），但
`query.proto` 只暴露了 `params` 和 `receipt_state` 两个查询，没导出来。

所以真链模式下 `*_remaining` 只能等于 `*_total`，并且
`BridgeLimits.usage_available = false`。**UI 必须据此标明「已用量未知」** ——
不标的话用户会以为额度是满的，按满额填金额，然后在链上被限流拒掉，
而且看不出为什么。

修法见下面「已知待办」。

---

## 数据来源：mock 和 chain

```
VITE_API_MODE=mock    模拟数据 + 状态机模拟 + 场景切换（默认）
VITE_API_MODE=chain   连真链
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
2. **整除判断** —— 桥要求金额是 100 ATOS 的整数倍（peg）。余数会在以太坊侧被
   静默吞掉：链上锁了全额 ATOS，却只让以太坊释放向下取整的部分，差额凭空消失。
   链上 `AtosToErc20` 会直接拒绝有余数的金额，前端要在提交前就挡住。

---

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000
```

默认 mock 模式，不需要节点也不需要钱包，页面完整可点。

连真链把 `VITE_API_MODE` 改成 `chain`。

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

1. **链侧加 bridgeadapter 预编译**，桥出才能用。见上文「桥出为什么还不能用」。
   这是整个桥的主功能，其它都排在它后面。

2. **链侧加一个 Limits 查询**，暴露今日已用量。
   `x/bridgeadapter/keeper` 里 `GetRateLimitState` / `GetAddressUsage` /
   `Limits(ctx)` 都有了，只差在 `query.proto` 加一个 rpc 和一个
   `google.api.http` 注解，再把 `Querier` 实现补上。改动很小，但没有它
   额度面板只能显示上限不能显示剩余。

3. **以太坊侧部署合约**，配 `VITE_ERC20_ATOS_ADDRESS` 和
   `VITE_COLLATERAL_ADDRESS`，桥入就通了。

4. **治理提案**把 `bridge_enabled` 改成 true，并设置 `mailbox_id` /
   `remote_bridge_vault` / `ethereum_domain`。
   注意 `ethereum_domain` 现在是 **1**（创世默认值，即以太坊主网），
   测试网应该是 **11155111**（Sepolia）—— 不改的话跨链消息发不到正确的链上。

5. **后端索引服务**，出跨链记录和状态查询。跨链记录天然需要两条链的数据
   （Atoshi 侧的 bridge_out 事件 + 以太坊侧 Mailbox 的 Dispatch/Process 事件），
   前端做不了。`getBridgeHistory` 目前返回空列表。
   注意别拿 `receipt_state` 去顶 —— 那是 tier 释放通道的回执状态，
   不是资产桥的转账记录，两个不是一回事。

6. **`messageId` 拿不到**。它是 `transferRemote` 的返回值，但 EVM 交易拿不到
   返回值，要从 Mailbox 的 `Dispatch` 事件里解。等有了合约地址再补，
   现在返回空字符串而不是编一个假的。

---

## 视觉约定

白底、浅灰分隔线、圆角卡片、移动端竖屏优先（375–430px），无深色模式 ——
与钱包内其他页面（如隐私交易、质押）保持一致。金额用等宽数字字体。
