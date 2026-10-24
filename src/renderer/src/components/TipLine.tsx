/**
 * TipLine：休息态护眼小贴士（P0-4 视觉辅助；showEyeCareTip 可关）。
 */
export interface TipLineProps {
  visible: boolean;
}

export function TipLine({ visible }: TipLineProps): JSX.Element | null {
  if (!visible) {
    return null;
  }
  return <div className="tip-line">小贴士：看看 6 米外 20 秒</div>;
}
