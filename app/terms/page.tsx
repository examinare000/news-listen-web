import Link from 'next/link'
import { BrandLogo } from '@/components/ui/BrandLogo'

export const metadata = {
  title: '利用規約 | NewsListen',
  description: 'NewsListenの利用規約',
}

export default function TermsPage() {
  return (
    <div className="lp-page">
      <header className="lp-header">
        <Link href="/">
          <BrandLogo />
        </Link>
      </header>

      <div className="legal-content">
        <h1>利用規約</h1>

        <section>
          <h2>サービス概要</h2>
          <p>
            NewsListen（以下、「本サービス」）は、招待制・無償の英語学習支援サービスです。
            世界中のニュースサイトから提供されるRSSフィード、および運営者が提供するおすすめソースから記事を収集し、
            AI技術により学習用ポッドキャスト（台本・音声）を自動生成します。
          </p>
        </section>

        <section>
          <h2>アカウント</h2>
          <h3>招待制登録</h3>
          <p>本サービスは招待制です。有効な招待コードをお持ちの方のみ、アカウントを登録できます。</p>

          <h3>利用資格</h3>
          <p>本サービスは、英語学習の目的で利用する個人ユーザーを対象としています。</p>

          <h3>禁止事項</h3>
          <p>ユーザーは、以下の行為をしてはなりません。</p>
          <ul>
            <li>不正アクセス、不正ログイン</li>
            <li>リバースエンジニアリング、逆アセンブル、逆コンパイル</li>
            <li>本サービスのセキュリティ機構の迂回</li>
            <li>本サービスへの過度な負荷をかける行為（自動クローリング等）</li>
            <li>他のユーザーまたは第三者の権利を侵害する行為</li>
            <li>法令に違反する行為</li>
          </ul>
        </section>

        <section>
          <h2>ユーザー追加フィードの責任分界</h2>
          <p>
            ユーザーがRSSフィードを本サービスに追加する際、その判断と責任は全てユーザーにあります。
            第三者の著作権、商標権、プライバシー権その他の権利を侵害するコンテンツを提供するソースを登録してはいけません。
          </p>
          <p>
            運営者は、権利者からの正式な削除申立に基づき、該当するソース・コンテンツを削除できます。
          </p>
        </section>

        <section>
          <h2>生成コンテンツのライセンス</h2>
          <p>
            本サービスが提供するポッドキャスト（台本・音声）は、
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noopener noreferrer">
              Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)
            </a>
            の下で提供されます。
          </p>
        </section>

        <section>
          <h2>削除申立（Notice &amp; Takedown）</h2>
          <p>
            著作権、商標権、プライバシー権その他の権利が侵害されていると考える場合、
            権利者は以下のメールアドレスまでご連絡ください。
          </p>
          <p>
            <a href="mailto:examinare000@gmail.com">examinare000@gmail.com</a>
          </p>
          <p>
            申立を受け取った運営者は、内容を確認し、原則として30日以内に該当コンテンツ・ソースの削除等の措置を講じます。
          </p>
        </section>

        <section>
          <h2>免責</h2>
          <p>
            本サービスは「現状のまま」提供されます。
            運営者は、コンテンツの正確性、完全性、有用性について一切保証しません。
            また、本サービスの変更、中断、終了によって生じた損害について責任を負いません。
          </p>
        </section>

        <section>
          <h2>規約の変更</h2>
          <p>
            運営者は、ユーザーへの事前通知により、本規約を変更できます。
            変更後のサービス利用をもって同意したものとみなします。
          </p>
        </section>

        <section>
          <h2>準拠法・管轄</h2>
          <p>本規約は日本法に準拠し、日本の裁判所の管轄に属します。</p>
        </section>

        <section className="legal-footer">
          <p>制定日: 2026-08-29</p>
        </section>
      </div>
    </div>
  )
}
