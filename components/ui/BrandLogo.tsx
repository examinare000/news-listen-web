interface BrandLogoProps {
  /**
   * ラッパーのクラス名。既定値は 'logo-mark'。
   * モーダルでは 'modal-logo' を渡す。
   */
  wrapperClassName?: string
}

/**
 * 共通ロゴコンポーネント。
 * 新聞+波形バーのグリフと「NewsListen」ワードマークを表示。
 * 構造は既存ロゴを踏襲し、`<span>Listen</span>` 部分がアンバー着色される。
 */
export function BrandLogo({ wrapperClassName = 'logo-mark' }: BrandLogoProps) {
  return (
    <div className={wrapperClassName}>
      <div className="logo-icon">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="10" height="16" rx="2" />
          <path d="M6 9h4" />
          <path d="M6 13h4" />
          <path d="M16 10v4" />
          <path d="M19 7v10" />
          <path d="M22 10.5v3" />
        </svg>
      </div>
      <span className="logo-text">
        News<span>Listen</span>
      </span>
    </div>
  )
}
