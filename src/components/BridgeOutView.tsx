import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  BookUser,
  Check,
  AlertCircle,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BridgeLimits, BridgeParams, AddressBookItem } from '../types';
import { QuotaPanel } from './QuotaPanel';
import {
  shouldShowQuota,
  validateBridgeOutAmount,
  isValidEthereumAddress,
  formatNumber,
} from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface BridgeOutViewProps {
  /**
   * 钱包连上了吗。
   *
   * 提交按钮原来不看这一项，所以没连钱包也能点 —— 而 mock 模式下点了还会
   * 「成功」。发起跨链必须签名，没有钱包连什么都做不了。
   */
  isConnected: boolean;
  params: BridgeParams | null;
  limits: BridgeLimits | null;
  userBalance: number;
  userAddress: string;
  recipientEth: string;
  onRecipientEthChange: (val: string) => void;
  isSubmitting: boolean;
  onSubmit: (amount: number, recipientEth: string) => Promise<void>;
  onOpenRulesModal: () => void;
}

export const BridgeOutView: React.FC<BridgeOutViewProps> = ({
  params,
  limits,
  userBalance,
  userAddress,
  recipientEth,
  onRecipientEthChange,
  isSubmitting,
  isConnected,
  onSubmit,
  onOpenRulesModal,
}) => {
  const { lang, t } = useI18n();
  const [amountStr, setAmountStr] = useState<string>('50000');
  const [isDisclaimerChecked, setIsDisclaimerChecked] = useState<boolean>(true);

  const amountNum = parseFloat(amountStr) || 0;

  // 核心实时校验计算（计算哪一层拦截）
  const validationResult = useMemo(() => {
    if (!limits || !params) return { isValid: false, isLargeTransfer: false };
    return validateBridgeOutAmount(amountNum, userBalance, limits, params, lang);
  }, [amountNum, userBalance, limits, params, lang]);

  // 计算将获得的 ERC20 ATOS 数量（固定 100:1）
  const receivedErc20Amount = useMemo(() => {
    if (!amountNum || isNaN(amountNum) || amountNum < 0) return 0;
    return Math.floor(amountNum / 100);
  }, [amountNum]);

  // 地址合法性校验
  const isEthAddressValid = isValidEthereumAddress(recipientEth);

  /**
   * 点击「最大」。
   *
   * 原来只填 limits.max_transferable —— 那是五层限流算出的**额度上限**，
   * 和钱包里有多少钱毫无关系。所以余额 999,781 的账户点一下就填进
   * 100,000,000，然后立刻显示「钱包余额不足」。测试反馈的就是这个。
   *
   * 三件事要一起考虑：
   *
   *   余额        显然的上限
   *   限流上限    链上会拒的上限
   *   gas 预留    桥出本身要付 gas，全部转走就没钱付了。预留 1 ATOS ——
   *               实际成本约 0.0007 ATOS（gasLimit 60 万 x gasPrice 1.1 gwei），
   *               1 ATOS 是它的一千多倍，而相对 1,000 ATOS 的单笔下限可以忽略。
   *
   * 再向下取整到整数 ATOS：界面上显示的余额是四舍五入过的，直接把浮点值填进去
   * 可能比真实余额大那么一点点，交易会在链上 revert —— 而报错和金额看着没关系。
   * 桥出下限是 1,000 ATOS，抹掉不到 1 ATOS 无所谓。
   *
   * 算出来低于下限时照样填 —— 让已有的校验提示「低于单笔最低限额」，
   * 那句话准确而且告诉了用户他现在的处境；填 0 反而看不出为什么。
   */
  const handleSetMax = () => {
    if (!limits) return;
    const GAS_RESERVE_ATOS = 1;
    const spendable = Math.max(0, userBalance - GAS_RESERVE_ATOS);
    const capped = Math.min(spendable, limits.max_transferable);
    setAmountStr(String(Math.floor(capped)));
  };

  // 采纳建议金额（例如整除 100 建议、大额降为 100k 等）
  const handleAdoptSuggestion = (val: number) => {
    setAmountStr(String(val));
  };


  const canSubmit =
    !isSubmitting &&
    isConnected &&
    params?.bridge_enabled &&
    validationResult.isValid &&
    isEthAddressValid &&
    isDisclaimerChecked;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(amountNum, recipientEth.trim());
  };

  const quickPresets = [
    { label: '1,000', value: 1000 },
    { label: '10,000', value: 10000 },
    { label: '50,000', value: 50000 },
    { label: '100,000', value: 100000, isSmallCap: true },
  ];

  // 桌面两栏：左边是表单（金额 → 方向 → 收款地址 → 提交），右边常驻额度面板。
  // 用 col-start 显式定位而不是改 DOM 顺序 —— 手机上顺序必须保持
  // 「输入金额 → 紧跟着看额度」，那是这个页面的核心交互。
  //
  // 治理关掉限流之后没有额度可显示，右栏必须一起收掉：340px 是写在 grid 模板
  // 里的固定列，只把面板藏起来会留下一条空白，表单也就不居中了。
  //
  // 收掉之后限宽居中而不是铺满：两栏时左栏实际约 636px（1080 容器 − 80 内边距
  // − 340 右栏 − 24 间距），让表单突然变成 1000px 宽会把输入框拉得很难看。
  // max-w-2xl（672px）最接近原来的宽度。
  const showQuota = shouldShowQuota(limits);

  return (
    <form
      onSubmit={handleSubmit}
      className={
        showQuota
          ? 'space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 lg:space-y-0'
          : 'space-y-4 lg:mx-auto lg:max-w-2xl'
      }
    >
      {/* 1. 金额输入与余额卡片 */}
      <div className="mt-2 lg:col-start-1">
        <div className="flex justify-between items-end mb-2">
          <label htmlFor="input-amount-atos" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_out.lock_label')}
          </label>
          <span className="text-xs text-gray-400">
            {t('bridge_out.balance')} <span className="font-mono text-gray-700 font-semibold">{formatNumber(userBalance)}</span>
          </span>
        </div>

        {/* 主输入框与“最大”按钮 */}
        <div className="relative">
          <input
            id="input-amount-atos"
            type="number"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            step="100"
            className="w-full text-2xl sm:text-3xl font-mono border-b-2 border-gray-200 py-2.5 focus:outline-none focus:border-black transition-colors pr-18 text-black placeholder:text-gray-300 font-bold"
          />
          <button
            type="button"
            id="btn-set-max-amount"
            onClick={handleSetMax}
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-100 hover:bg-gray-200 text-xs font-bold px-3 py-1.5 rounded-md text-gray-800 transition-colors"
          >
            {t('bridge_out.max')}
          </button>
        </div>

        {/* 快捷预设 Chips */}
        <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[10px] uppercase font-bold text-gray-400 shrink-0">{t('bridge_out.quick')}</span>
          {quickPresets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setAmountStr(String(preset.value))}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all shrink-0 font-medium ${
                amountNum === preset.value
                  ? 'bg-black text-white border-black font-bold'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {preset.label}
              {preset.isSmallCap && <span className="text-[9px] ml-0.5 opacity-80">({t('bridge_out.small_cap')})</span>}
            </button>
          ))}
        </div>

        {/* 实时校验与哪一层拦截的反馈 Banner */}
        {validationResult.errorMessage && (
          <div
            id="amount-validation-alert"
            className="mt-2.5 p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-900 text-xs flex items-start gap-2 animate-in fade-in duration-150"
          >
            <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">{validationResult.errorMessage}</div>
              {validationResult.suggestedAmount !== undefined && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[11px] text-orange-800">{t('bridge_out.suggest_label')}</span>
                  <button
                    type="button"
                    id="btn-adopt-suggested-amount"
                    onClick={() => handleAdoptSuggestion(validationResult.suggestedAmount!)}
                    className="px-2.5 py-0.5 bg-black text-white hover:bg-gray-800 rounded text-[11px] font-mono font-bold transition-colors flex items-center gap-1 shadow-2xs"
                  >
                    <span>{formatNumber(validationResult.suggestedAmount)} ATOS</span>
                    <span className="text-[9px] text-gray-300 underline ml-0.5">{t('bridge_out.adopt_btn')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 换算将收到的 ERC20 数量 */}
        <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>{t('bridge_out.receive_label')}</span>
          <div className="text-right">
            <span className="font-mono text-sm font-bold text-black">
              {formatNumber(receivedErc20Amount)}
            </span>
            <span className="font-mono text-[11px] font-semibold text-gray-500 ml-1">{t('bridge_out.erc20_unit')}</span>
          </div>
        </div>
      </div>

      {/* 2. 额度面板。手机上紧跟金额输入；桌面上移到右栏并吸顶 */}
      {showQuota && (
        <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-6">
          <QuotaPanel
            limits={limits}
            params={params}
            inputAmount={amountNum}
            highlightTier={validationResult.highlightTier}
            onOpenRulesModal={onOpenRulesModal}
          />
        </div>
      )}

      {/* 3. 中间方向转换示意分割线 */}
      <div className="flex items-center justify-center py-1 lg:col-start-1">
        <div className="h-[1px] bg-gray-200 flex-1"></div>
        <div className="mx-4 bg-gray-100 rounded-full p-2 text-gray-500">
          <ArrowRight className="w-4 h-4" />
        </div>
        <div className="h-[1px] bg-gray-200 flex-1"></div>
      </div>

      {/* 4. 收款地址输入卡片 */}
      <div className="space-y-2 lg:col-start-1">
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="input-recipient-eth" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_out.recipient_label')}
          </label>
        </div>

        <div>
          <input
            id="input-recipient-eth"
            type="text"
            value={recipientEth}
            onChange={(e) => onRecipientEthChange(e.target.value)}
            placeholder={t('bridge_out.recipient_placeholder')}
            className={`w-full text-xs sm:text-sm font-mono border bg-gray-50 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all ${
              recipientEth && !isEthAddressValid
                ? 'border-rose-300 focus:ring-rose-500'
                : 'border-gray-200'
            }`}
          />

          {recipientEth && !isEthAddressValid && (
            <p className="text-[11px] text-rose-600 mt-1 font-medium">
              {t('bridge_out.invalid_eth_addr')}
            </p>
          )}
        </div>

        {/* 必选勾选框：确认以太坊地址所有权 */}
        <div className="p-3.5 bg-blue-50/60 rounded-lg border border-blue-100">
          <label
            htmlFor="checkbox-eth-ownership"
            className="flex items-start cursor-pointer select-none text-xs text-blue-800 leading-relaxed"
          >
            <input
              id="checkbox-eth-ownership"
              type="checkbox"
              checked={isDisclaimerChecked}
              onChange={(e) => setIsDisclaimerChecked(e.target.checked)}
              className="mt-0.5 mr-2.5 w-4 h-4 rounded text-black focus:ring-black border-gray-300"
            />
            <span>{t('bridge_out.disclaimer')}</span>
          </label>
        </div>
      </div>

      {/* 5. 提交按钮 */}
      <div className="pt-2 lg:col-start-1">
        <button
          type="submit"
          id="btn-submit-bridge-out"
          disabled={!canSubmit}
          className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 ${
            canSubmit
              ? 'bg-black text-white hover:opacity-90 active:scale-[0.98] shadow-md cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              <span>{t('bridge_out.btn_submitting')}</span>
            </>
          ) : !isConnected ? (
            <span>{t('common.connect_wallet_first')}</span>
          ) : !params?.bridge_enabled ? (
            <span>{t('bridge_out.btn_maint')}</span>
          ) : !validationResult.isValid ? (
            <span>{validationResult.errorMessage || t('bridge_out.btn_invalid_amount')}</span>
          ) : !isEthAddressValid ? (
            <span>{t('bridge_out.btn_invalid_addr')}</span>
          ) : !isDisclaimerChecked ? (
            <span>{t('bridge_out.btn_check_disclaimer')}</span>
          ) : (
            <>
              <span>{t('bridge_out.btn_submit')}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <p className="text-center text-[10px] text-gray-400 mt-2 font-mono">
          {t('bridge_out.security_note')}
        </p>
      </div>
    </form>
  );
};

