/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BridgeParams,
  BridgeLimits,
  BridgeRecord,
  BridgeDirection,
} from './types';
import {
  bridgeService,
  IS_CHAIN_MODE,
  IS_MOCK_MODE,
} from './services/bridgeApi';
import { useWallet } from './wallet/useWallet';
import { WalletBar } from './components/WalletBar';
import { Header } from './components/Header';
import { BridgeOutView } from './components/BridgeOutView';
import { BridgeInView } from './components/BridgeInView';
import { RulesExplanationModal } from './components/RulesExplanationModal';
import { TransactionModal } from './components/TransactionModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { FAQAndSupportModal } from './components/FAQAndSupportModal';
import { ArrivalToast } from './components/ArrivalToast';
import { ShieldX } from 'lucide-react';
import { useI18n } from './i18n';
import { loadRecords, mergeRecords, patchRecord, saveRecord } from './services/bridgeRecords';
import { applyDelivery, confirmDelivery, isSettled } from './services/bridgeStatus';
import { getTransactionErrorMessage } from './utils/transactionError';

export default function App() {
  const { t } = useI18n();
  const [params, setParams] = useState<BridgeParams | null>(null);
  const [limits, setLimits] = useState<BridgeLimits | null>(null);
  const [records, setRecords] = useState<BridgeRecord[]>([]);
  const [activeDirection, setActiveDirection] = useState<BridgeDirection>('out');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // 初始值必须是「空」而不是演示数据。
  //
  // 这几个字段原来分别写死了 3,850,000 / 25,000 和一个 0x71C8… 的地址。没连
  // 钱包时页面照样显示这些数字和一个预填的收款地址，看起来像是查到了真实
  // 余额 —— 测试同学报的「未连钱包却有余额」「接收地址自动填了个不认识的
  // 地址」就是这个。
  const [balanceAtos, setBalanceAtos] = useState<number>(0);
  const [balanceErc20, setBalanceErc20] = useState<number>(0);
  const [recipientEth, setRecipientEth] = useState<string>('');
  const [recipientAtoshi, setRecipientAtoshi] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal 控制
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState<boolean>(false);
  const [isFAQModalOpen, setIsFAQModalOpen] = useState<boolean>(false);
  /**
   * 弹窗里显示哪条记录 —— 只存 id，记录本身从 records 里派生。
   *
   * 原来直接存整个 record 对象，结果关不掉：fetchData 的依赖里有
   * activeRecord，而它内部又 setActiveRecord(新解析出来的对象)。新对象身份
   * 不同 → 依赖变 → fetchData 重建 → effect 重跑 → 立刻再 fetch → 再设新
   * 对象，一直转。用户点关闭时 activeRecord 变 null，但**已经在飞行中**的
   * 那次 fetchData 闭包里还是旧的非空值，它完成时又把弹窗设回来 ——
   * 循环转得快，几乎总有一次在飞行中，所以弹窗关不掉。
   *
   * 存 id 就没这个问题：派生值没法自己复活，而且状态更新只走一条路
   * （records），不会有两份可能不一致的副本。
   */
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  // 刚确认到账的那条 —— 用来弹提示。存 id，和 activeRecordId 同理。
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [selectedTxIdForSupport, setSelectedTxIdForSupport] = useState<string | undefined>(undefined);

  // 钱包给的是 0x 地址，Cosmos REST 的查询路径只认 atoshi1…，useWallet 里已转好。
  //
  // 没连钱包时这里是空串，不再退回兜底地址。原来退回 FALLBACK_ATOSHI_ADDRESS
  // 是「让页面有东西可渲染」，但代价是顶栏显示一个用户并不拥有的地址、还带着
  // 绿色的已连接圆点，并且拿那个地址去查余额和额度。
  const wallet = useWallet();
  const currentAddress = wallet.bech32Address;
  const currentEthAddress = wallet.address || '';
  const isConnected = wallet.isConnected && Boolean(currentAddress);

  // 同一个账户的两种表示，用来筛出「属于我的」本地记录。
  // 桥入的 sender 是 0x（以太坊侧），桥出的 sender 是 atoshi1 —— 两个都要。
  const arrivedRecord = useMemo(
    () => (arrivedId ? records.find((r) => r.id === arrivedId) ?? null : null),
    [arrivedId, records],
  );

  // 弹窗显示的记录：从 records 里按 id 取。找不到就是 null（弹窗自然关掉）。
  const activeRecord = useMemo(
    () => (activeRecordId ? records.find((r) => r.id === activeRecordId) ?? null : null),
    [activeRecordId, records],
  );

  const addressForms = useMemo(
    () => [currentAddress, currentEthAddress].filter(Boolean),
    [currentAddress, currentEthAddress],
  );

  // 加载数据
  const fetchData = useCallback(async () => {
    try {
      // 参数和限流上限是全局的，不连钱包也能看（页面上那句「查看额度无需连接」）。
      // 余额、已用额度、历史都是按地址的 —— 没地址就不要发这些请求：拿空串去
      // 查会得到一个看起来正常但毫无意义的结果。
      const [fetchedParams, fetchedLimits] = await Promise.all([
        bridgeService.getBridgeParams(),
        bridgeService.getBridgeLimits(currentAddress || undefined),
      ]);
      setParams(fetchedParams);
      setLimits(fetchedLimits);

      if (currentAddress) {
        const [fetchedHistory, atos, erc20] = await Promise.all([
          bridgeService.getBridgeHistory(currentAddress),
          bridgeService.getUserBalanceAtos(currentAddress),
          // ERC20 余额是以太坊侧的合约调用，钱包没连到那条链时查不到
          bridgeService.getUserBalanceErc20().catch(() => 0),
        ]);
        // 本地记录必须参与合并。
        //
        // getBridgeHistory 恒返回空数组（没有索引服务），而这里原来直接
        // setRecords(空) —— 结果用户刚提交产生的记录在下一次自动刷新时就被
        // 覆盖掉了，弹窗里的状态也永远停在「进行中」。
        // 「跨链历史是空的」和「关掉弹窗就找不回来」是同一个 bug。
        setRecords(mergeRecords(loadRecords(addressForms), fetchedHistory.list));
        setBalanceAtos(atos);
        setBalanceErc20(erc20);

        // 弹窗不用在这里同步 —— 它显示的记录是从 records 派生的（见
        // activeRecordId），records 一更新弹窗自然跟着变。
      } else {
        setRecords([]);
        setBalanceAtos(0);
        setBalanceErc20(0);
      }
      setLoadError(null);
    } catch (e: any) {
      // 不再静默忽略。mock 模式下这里几乎不会触发；真链模式下节点连不上、
      // 跨域被拦、REST 没开，全都走到这儿 —— 吞掉的话页面只是不更新，
      // 看起来一切正常，是最难排查的一种故障。
      setLoadError(e?.message || t('error.load_chain_data'));
    }
  }, [currentAddress, addressForms]);

  // 收款地址跟着钱包走：连上就填自己的地址，断开就清空。
  //
  // 桥出收的是以太坊地址，桥入收的是 Atoshi 地址，而钱包的同一把密钥两边都有
  // 表示形式，所以两个方向都能自动填。用户改过之后不再覆盖（只在地址本身变化
  // 时同步），否则输入一半会被刷掉。
  useEffect(() => {
    setRecipientEth(currentEthAddress || '');
  }, [currentEthAddress]);

  useEffect(() => {
    // 预填 0x 形式，不是 bech32。两种都能收（同一个账户），但用户手上有的、
    // 认得出的是 0x —— 预填 atoshi1… 他没法判断那是不是自己的地址。
    // 输入框下面会把换算出的 atoshi1… 显示出来给他核对。
    setRecipientAtoshi(currentEthAddress || '');
  }, [currentEthAddress]);

  useEffect(() => {
    fetchData();
    // mock 的状态机靠这个轮询自动步进，所以要快。真链模式下没有东西会自己
    // 步进，2.5 秒一轮就是每秒两次 REST 请求的纯浪费，还容易被限流。
    const interval = setInterval(fetchData, IS_CHAIN_MODE ? 15000 : 2500);
    return () => clearInterval(interval);
  }, [fetchData]);

  /**
   * 到账确认轮询。
   *
   * 提交成功只说明源链收下了，钱到没到在目标链上。原来提交完记录就永远停在
   * 「进行中」，用户只能自己去区块浏览器查 —— 而桥入的目标链是 Atoshi，
   * 普通用户不知道去哪查。
   *
   * 两个方向都是真查链（见 bridgeStatus.ts）：桥入按 message_id 检索 Atoshi
   * 上带 bridge_in 事件的放款交易，桥出问以太坊 Mailbox 的 delivered()。
   * 不用「余额涨了」这种信号 —— 那会把别人转来的钱算成到账。
   *
   * 只查未终结的记录，查到了就写回 localStorage，所以刷新页面、关掉弹窗
   * 再打开，看到的都是已经确认过的状态。
   */
  useEffect(() => {
    if (!IS_CHAIN_MODE) return;

    let cancelled = false;

    const tick = async () => {
      const pending = loadRecords(addressForms).filter((r) => !isSettled(r));
      if (pending.length === 0) return;

      for (const record of pending) {
        if (cancelled) return;
        const res = await confirmDelivery(record);
        // unknown 表示查不动（节点不通、缺 messageId），保持原状再等下一轮 ——
        // 不能当成「没到账」写进记录里。
        if (!res.delivered) continue;

        const updated = applyDelivery(record, res);
        patchRecord(updated.id, updated);
        if (cancelled) return;
        setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        // 到账了就弹提示 —— 用户大概率已经关掉弹窗了（跨链要一分钟左右，
        // 没人会一直盯着）。不弹的话他只能自己去翻历史才知道成了。
        setArrivedId(updated.id);
      }
    };

    tick();
    // 15 秒一轮。跨链正常在 1-2 分钟，再快只是多打链、看不出差别；
    // 而失败重试的间隔本身就是分钟级的（relayer 那边指数退避）。
    const timer = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [addressForms]);

  // 桥出提交处理
  const handleSubmitBridgeOut = async (amount: number, recipientEth: string) => {
    setIsSubmitting(true);
    try {
      const res = await bridgeService.submitBridgeOut({
        sender: currentAddress,
        recipient_eth_address: recipientEth,
        amount_atos: amount,
      });
      // 先落本地再刷新。原来是先 fetchData() 再 setActiveRecord —— 那次
      // fetchData 会把刚产生的记录冲掉，只剩 activeRecord 一个孤立引用，
      // 关掉弹窗就再也找不回来。
      saveRecord(res.record);
      // 先塞进 records 再开弹窗。activeRecord 是从 records 派生的，
      // 不这么做的话弹窗要等下一轮 fetchData 才有内容，会闪一下空白。
      setRecords((prev) => mergeRecords([res.record], prev));
      setActiveRecordId(res.record.id);
      await fetchData();
    } catch (error: unknown) {
      alert(`${t('error.bridge_out_failed')}: ${getTransactionErrorMessage(error, t)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 桥入提交处理
  const handleSubmitBridgeIn = async (amountErc20: number, recipientAtoshi: string) => {
    setIsSubmitting(true);
    try {
      const res = await bridgeService.submitBridgeIn({
        sender: currentEthAddress,
        recipient_atoshi_address: recipientAtoshi,
        amount_erc20: amountErc20,
      });
      // 先落本地再刷新。原来是先 fetchData() 再 setActiveRecord —— 那次
      // fetchData 会把刚产生的记录冲掉，只剩 activeRecord 一个孤立引用，
      // 关掉弹窗就再也找不回来。
      saveRecord(res.record);
      // 先塞进 records 再开弹窗。activeRecord 是从 records 派生的，
      // 不这么做的话弹窗要等下一轮 fetchData 才有内容，会闪一下空白。
      setRecords((prev) => mergeRecords([res.record], prev));
      setActiveRecordId(res.record.id);
      await fetchData();
    } catch (error: unknown) {
      alert(`${t('error.bridge_in_failed')}: ${getTransactionErrorMessage(error, t)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重试桥入放款
  const handleRetryBridgeIn = async (recordId: string) => {
    await bridgeService.retryBridgeIn(recordId);
    await fetchData();
  };



  const pendingCount = records.filter(
    (r) => r.status !== 'completed' && r.status !== 'failed'
  ).length;

  const isBridgeDisabled = params && !params.bridge_enabled;

  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-start sm:justify-center py-0 sm:py-6 px-0 sm:px-4 selection:bg-black selection:text-white">
      {/*
        自适应外壳。
        手机（默认）：420px 竖屏卡片，铺满屏幕高度。
        桌面（lg 起）：加宽到 1040px，内容分两栏 —— 表单在左，额度面板在右。
        分栏由 BridgeOutView 自己的 lg:grid 负责，这里只放开宽度。
      */}
      <div className="w-full max-w-[420px] bg-white min-h-screen sm:min-h-0 sm:rounded-2xl shadow-2xl border border-gray-200 flex flex-col relative overflow-hidden lg:max-w-[1040px]">
        {/*
          mock 模式必须一眼看出来。
          这个模式会编造交易哈希并把流程走完打上「已完成」，和真链在界面上
          没有任何区别 —— 一次忘配环境变量就足以让人以为跨链成功了。
        */}
        {IS_MOCK_MODE && (
          <div className="bg-amber-500 text-white text-[11px] font-bold text-center py-1.5 px-3 leading-snug">
            {t('mock.banner')}
          </div>
        )}

        {/* 顶部导航与方向切换 */}
        {/*
          顶栏显示 0x 形式。用户从 MetaMask 过来，认的是这个 —— 顶栏挂一个
          atoshi1… 会让人以为连错了钱包。bech32 只在真正需要它的地方出现：
          Cosmos REST 的查询路径（余额、额度、历史都按 bech32 查）和桥入
          收款地址下面那行换算提示。
        */}
        <Header
          currentAddress={currentEthAddress}
          isConnected={isConnected}
          balanceAtos={balanceAtos}
          activeDirection={activeDirection}
          onDirectionChange={setActiveDirection}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onOpenFAQ={() => {
            setSelectedTxIdForSupport(undefined);
            setIsFAQModalOpen(true);
          }}
          pendingCount={pendingCount}
          bridgeEnabled={params?.bridge_enabled ?? true}
        />

        <WalletBar
          side={activeDirection === 'out' ? 'atoshi' : 'ethereum'}
          isConnected={wallet.isConnected}
          isConnecting={wallet.isConnecting}
          isSwitching={wallet.isSwitching}
          hasProvider={wallet.hasProvider}
          isOnRightChain={wallet.isOnChainFor(activeDirection === 'out' ? 'atoshi' : 'ethereum')}
          loadError={loadError}
          address={wallet.address}
          onConnect={wallet.connect}
          onSwitch={() => wallet.switchTo(activeDirection === 'out' ? 'atoshi' : 'ethereum')}
          onDisconnect={wallet.disconnect}
        />

        {/* 主体内容 */}
        <main className="p-6 space-y-4 flex-1 lg:px-10 lg:py-8">
          {/* 跨链功能暂停全屏遮罩状态 */}
          {isBridgeDisabled ? (
            <div
              id="bridge-disabled-banner"
              className="bg-orange-50 border border-orange-200 rounded-2xl p-6 text-center space-y-3 animate-in fade-in duration-200 my-8"
            >
              <div className="w-14 h-14 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto">
                <ShieldX className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-gray-900">{t('maint.title')}</h2>
              <p className="text-xs text-gray-600 leading-relaxed max-w-xs mx-auto">
                {t('maint.desc')}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={fetchData}
                  className="px-4 py-2 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  {t('maint.btn_restore')}
                </button>
              </div>
            </div>
          ) : activeDirection === 'out' ? (
            /* 桥出视图（Atoshi ➔ ETH，五层限流核心实现） */
            <BridgeOutView
              params={params}
              limits={limits}
              userBalance={balanceAtos}
              userAddress={currentAddress}
              recipientEth={recipientEth}
              onRecipientEthChange={setRecipientEth}
              isSubmitting={isSubmitting}
              isConnected={isConnected}
              onSubmit={handleSubmitBridgeOut}
              onOpenRulesModal={() => setIsRulesModalOpen(true)}
            />
          ) : (
            /* 桥入视图（ETH ➔ Atoshi，无限流，等待流动性补充状态机） */
            <BridgeInView
              params={params}
              limits={limits}
              userErc20Balance={balanceErc20}
              recipientAtoshi={recipientAtoshi}
              onRecipientAtoshiChange={setRecipientAtoshi}
              isSubmitting={isSubmitting}
              isConnected={isConnected}
              onSubmit={handleSubmitBridgeIn}
              onOpenFAQ={() => {
                setSelectedTxIdForSupport(undefined);
                setIsFAQModalOpen(true);
              }}
            />
          )}
        </main>

        {/* 底部信息与品牌 */}
        <footer className="px-6 py-3.5 border-t border-gray-100 bg-white text-center text-[10px] text-gray-400 font-mono space-y-0.5">
          <div>{t('app.footer_text')}</div>
          <div className="text-[9px] text-gray-400">
            {t('app.footer_sub')}
          </div>
        </footer>
      </div>

      {/* 弹窗组件群 */}
      {/* 1. 五层限流规则详解弹窗 */}
      <RulesExplanationModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        limits={limits}
        params={params}
      />

      {/* 2. 常用地址簿弹窗 */}


      {/* 3. 四步状态机进度追踪弹窗 */}
      <TransactionModal
        isOpen={!!activeRecord}
        onClose={() => setActiveRecordId(null)}
        record={activeRecord}
        onOpenSupport={(recordId) => {
          setSelectedTxIdForSupport(recordId);
          setIsFAQModalOpen(true);
        }}
        onRetryBridgeIn={handleRetryBridgeIn}
      />

      {/* 4. 历史记录抽屉 */}
      <HistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        records={records}
        onSelectRecord={(rec) => {
          setIsHistoryDrawerOpen(false);
          setActiveRecordId(rec.id);
        }}
      />

      <ArrivalToast
        record={arrivedRecord}
        onView={() => {
          setArrivedId(null);
          setActiveRecordId(arrivedRecord?.id ?? null);
        }}
        onDismiss={() => setArrivedId(null)}
      />

      {/* 5. 常见问题与客服支持弹窗 */}
      <FAQAndSupportModal
        isOpen={isFAQModalOpen}
        onClose={() => setIsFAQModalOpen(false)}
        selectedTxId={selectedTxIdForSupport}
      />
    </div>
  );
}
