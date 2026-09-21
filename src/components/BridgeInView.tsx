import React, { useState, useMemo } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { BridgeParams, BridgeLimits, AddressBookItem } from '../types';
import {
  isValidAtoshiAddress,
  formatNumber,
} from '../utils/bridgeValidation';
import { useI18n } from '../i18n';
import { bech32ToHex, hexToBech32 } from '../wallet/chains';

interface BridgeInViewProps {
  /**
   * 钱包连上了吗。
   *
   * 提交按钮原来不看这一项，所以没连钱包也能点 —— 而 mock 模式下点了还会
   * 「成功」。发起跨链必须签名，没有钱包连什么都做不了。
   */
  isConnected: boolean;
  params: BridgeParams | null;
  /**
   * 链上限流。桥入只受其中一项约束：inbound_cap（全链每日总额度）。
   * 为 null（还没拉到）或 cap 为 0（链上未配置 = 不限）时退回「自由放行」的说法。
   */
  limits: BridgeLimits | null;
  userErc20Balance: number;
  recipientAtoshi: string;
  onRecipientAtoshiChange: (val: string) => void;
  isSubmitting: boolean;
  onSubmit: (amountErc20: number, recipientAtoshi: string) => Promise<void>;
  onOpenFAQ: () => void;
}

export const BridgeInView: React.FC<BridgeInViewProps> = ({
  params,
  limits,
  userErc20Balance,
  recipientAtoshi,
  onRecipientAtoshiChange,
  isSubmitting,
  isConnected,
  onSubmit,
  onOpenFAQ,
}) => {
  const { t } = useI18n();
  const [amountErc20Str, setAmountErc20Str] = useState<string>('500');
  const [isDisclaimerChecked, setIsDisclaimerChecked] = useState<boolean>(true);

  const amountErc20Num = parseFloat(amountErc20Str) || 0;

  // 计算将获得的 Atoshi 主网原生 ATOS 数量（输入 × 100）
  const willReceiveAtos = useMemo(() => {
    if (!amountErc20Num || isNaN(amountErc20Num) || amountErc20Num < 0) return 0;
    return amountErc20Num * 100;
  }, [amountErc20Num]);

  // 桥入的额度是按 Atoshi 侧的 ATOS 计的，而输入框填的是以太坊侧的 ERC20，
  // 100:1。拿 willReceiveAtos 去比，不是 amountErc20Num —— 差 100 倍。
  // 限流被治理关掉时 inbound_cap 仍然返回真实数字（参数还在链上），所以要先看
  // 开关再看数值 —— 否则会画一条没人在执行的额度条。
  const inboundCap = limits?.rate_limits_disabled ? 0 : (limits?.inbound_cap ?? 0);
  const hasInboundCap = inboundCap > 0;
  const inboundRemaining = limits?.inbound_remaining ?? 0;
  const overInboundCap = hasInboundCap && willReceiveAtos > inboundRemaining;

  // 0x 和 atoshi1 两种都收 —— 同一个账户的两种表示
  const isAtoshiAddressValid = isValidAtoshiAddress(recipientAtoshi);

  // 换算成另一种形式给用户核对。换算失败就不显示，不弹错 ——
  // 合法性由上面那个判断负责，这里只是个辅助显示。
  const otherForm = useMemo(() => {
    const a = recipientAtoshi.trim();
    if (!a || !isAtoshiAddressValid) return '';
    try {
      return a.startsWith('0x') ? hexToBech32(a) : bech32ToHex(a);
    } catch {
      return '';
    }
  }, [recipientAtoshi, isAtoshiAddressValid]);

  // 余额校验
  const isBalanceEnough = amountErc20Num > 0 && amountErc20Num <= userErc20Balance;

  /**
   * 点击「最大」。桥入不用预留 gas —— 这边的 gas 付的是 ETH，不占 ERC20。
   *
   * 但要向下取整：界面上的余额是四舍五入过的，直接把浮点值填进去可能比真实
   * 余额大一点点，approve/transferRemote 会 revert 在一个和金额看着无关的地方。
   *
   * 取到 6 位小数而不是整数：桥入**没有**下限（链上只要求 > 0），0.5 个 ERC20
   * 是合法的一笔（换 50 ATOS），取整会把它抹成 0。桥出那边下限是 1,000 ATOS，
   * 所以那边取整到整数无所谓 —— 两边不一样是因为下限不一样。
   */
  const handleSetMax = () => {
    setAmountErc20Str(String(Math.floor(userErc20Balance * 1e6) / 1e6));
  };


  const canSubmit =
    !isSubmitting &&
    isConnected &&
    params?.bridge_enabled &&
    amountErc20Num > 0 &&
    isBalanceEnough &&
    isAtoshiAddressValid &&
    isDisclaimerChecked &&
    // 超了日额度就别让他发。ERC20 是在以太坊侧先锁的，Atoshi 侧拒收之后钱不会丢
    // （relayer 会一直重投，额度重置后放行），但用户会看到一笔卡住的跨链，
    // 而且要等到第二天 —— 在按钮这里拦住比事后解释便宜得多。
    !overInboundCap;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(amountErc20Num, recipientAtoshi.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 lg:mx-auto lg:max-w-[560px]">
      {/* 1. 金额输入与余额卡片 */}
      <div className="mt-2">
        <div className="flex justify-between items-end mb-2">
          <label htmlFor="input-amount-erc20" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_in.lock_label')}
          </label>
          <span className="text-xs text-gray-400">
            {t('bridge_in.balance')} <span className="font-mono text-gray-700 font-semibold">{formatNumber(userErc20Balance)}</span>
          </span>
        </div>

        {/* 主输入框与“最大”按钮 */}
        <div className="relative">
          <input
            id="input-amount-erc20"
            type="number"
            value={amountErc20Str}
            onChange={(e) => setAmountErc20Str(e.target.value)}
            placeholder="0"
            min="1"
            step="1"
            className="w-full text-2xl sm:text-3xl font-mono border-b-2 border-gray-200 py-2.5 focus:outline-none focus:border-black transition-colors pr-18 text-black placeholder:text-gray-300 font-bold"
          />
          <button
            type="button"
            id="btn-set-max-erc20"
            onClick={handleSetMax}
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-100 hover:bg-gray-200 text-xs font-bold px-3 py-1.5 rounded-md text-gray-800 transition-colors"
          >
            {t('bridge_in.max')}
          </button>
        </div>

        {/* 余额不足错误提示 */}
        {amountErc20Num > userErc20Balance && (
          <p className="text-[11px] text-rose-600 font-medium mt-1">
            {t('bridge_in.insufficient_balance')}
          </p>
        )}

        {/* 换算将收到的 ATOS 数量 */}
        <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>{t('bridge_in.receive_label')}</span>
          <div className="text-right">
            <span className="font-mono text-sm font-bold text-black">
              {formatNumber(willReceiveAtos)}
            </span>
            <span className="font-mono text-[11px] font-semibold text-gray-500 ml-1">{t('bridge_in.atos_unit')}</span>
          </div>
        </div>
      </div>

      {/* 2. 桥入规则卡片。链上配了日额度就显示真实数字，没配才说「自由放行」 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <ShieldCheck className={`w-4 h-4 ${hasInboundCap ? 'text-gray-700' : 'text-green-600'}`} />
            <span>{hasInboundCap ? t('bridge_in.rules_title_capped') : t('bridge_in.rules_title')}</span>
          </span>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
              hasInboundCap ? 'bg-gray-200 text-gray-800' : 'bg-green-100 text-green-800'
            }`}
          >
            {hasInboundCap ? t('bridge_in.rules_badge_capped') : t('bridge_in.rules_badge')}
          </span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          {t('bridge_in.rules_desc')}
        </p>

        {hasInboundCap && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-600">{t('bridge_in.rules_cap_label')}</span>
              <span className="font-mono text-gray-800">
                <span className="font-bold text-black">{formatNumber(inboundRemaining)}</span>
                {' / '}
                {formatNumber(inboundCap)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-gray-800 transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, (inboundRemaining / inboundCap) * 100))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              {t('bridge_in.rules_cap_note')}
            </p>
            {overInboundCap && (
              <p className="text-[11px] text-red-600 font-medium leading-relaxed">
                {t('bridge_in.rules_cap_exceeded')}
              </p>
            )}
          </div>
        )}

        {/* 流动性保障说明 */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
          <div className="flex items-center justify-between font-bold text-gray-800 text-[11px]">
            <span className="flex items-center gap-1">
              <span>{t('bridge_in.queue_title')}</span>
            </span>
            <button
              type="button"
              onClick={onOpenFAQ}
              className="text-black hover:underline font-bold text-[10px] flex items-center gap-0.5"
            >
              <span>{t('bridge_in.faq_link')}</span>
              <HelpCircle className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            {t('bridge_in.queue_desc')}
          </p>
        </div>
      </div>

      {/* 3. 中间方向转换示意分割线 */}
      <div className="flex items-center justify-center py-1">
        <div className="h-[1px] bg-gray-200 flex-1"></div>
        <div className="mx-4 bg-gray-100 rounded-full p-2 text-gray-500">
          <ArrowRight className="w-4 h-4" />
        </div>
        <div className="h-[1px] bg-gray-200 flex-1"></div>
      </div>

      {/* 4. 收款 Atoshi 地址输入卡片 */}
      <div className="space-y-2">
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="input-recipient-atoshi" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_in.recipient_label')}
          </label>
        </div>

        <div>
          <input
            id="input-recipient-atoshi"
            type="text"
            value={recipientAtoshi}
            onChange={(e) => onRecipientAtoshiChange(e.target.value)}
            placeholder={t('bridge_in.recipient_placeholder')}
            className={`w-full text-xs sm:text-sm font-mono border bg-gray-50 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all ${
              recipientAtoshi && !isAtoshiAddressValid
                ? 'border-rose-300 focus:ring-rose-500'
                : 'border-gray-200'
            }`}
          />

          {recipientAtoshi && !isAtoshiAddressValid && (
            <p className="text-[11px] text-rose-600 mt-1 font-medium">
              {t('bridge_in.invalid_addr')}
            </p>
          )}

          {/*
            填了 0x 就把 atoshi1 形式显示出来（反之亦然）。
            两种形式是同一个账户，但用户没理由相信这句话 —— 把换算结果摆出来
            让他自己核对，比在旁边写一行「这两个是同一个地址」有用。
          */}
          {recipientAtoshi && isAtoshiAddressValid && otherForm && (
            <p className="text-[11px] text-gray-500 mt-1 font-mono break-all">
              <span className="font-sans">{t('bridge_in.same_account')}</span>{' '}
              {otherForm}
            </p>
          )}
        </div>

        {/* 必选确认 */}
        <div className="p-3.5 bg-blue-50/60 rounded-lg border border-blue-100">
          <label
            htmlFor="checkbox-atoshi-ownership"
            className="flex items-start cursor-pointer select-none text-xs text-blue-800 leading-relaxed"
          >
            <input
              id="checkbox-atoshi-ownership"
              type="checkbox"
              checked={isDisclaimerChecked}
              onChange={(e) => setIsDisclaimerChecked(e.target.checked)}
              className="mt-0.5 mr-2.5 w-4 h-4 rounded text-black focus:ring-black border-gray-300"
            />
            <span>{t('bridge_in.disclaimer')}</span>
          </label>
        </div>
      </div>

      {/* 5. 提交按钮 */}
      <div className="pt-2">
        <button
          type="submit"
          id="btn-submit-bridge-in"
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
              <span>{t('bridge_in.btn_submitting')}</span>
            </>
          ) : !isConnected ? (
            <span>{t('common.connect_wallet_first')}</span>
          ) : !params?.bridge_enabled ? (
            <span>{t('bridge_in.btn_maint')}</span>
          ) : !amountErc20Num || amountErc20Num <= 0 ? (
            <span>{t('bridge_in.btn_enter_amount')}</span>
          ) : !isBalanceEnough ? (
            <span>{t('bridge_in.btn_insufficient')}</span>
          ) : !isAtoshiAddressValid ? (
            <span>{t('bridge_in.btn_invalid_addr')}</span>
          ) : !isDisclaimerChecked ? (
            <span>{t('bridge_in.btn_check_disclaimer')}</span>
          ) : (
            <>
              <span>{t('bridge_in.btn_submit')}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <p className="text-center text-[10px] text-gray-400 mt-2 font-mono">
          {t('bridge_in.security_note')}
        </p>
      </div>
    </form>
  );
};

