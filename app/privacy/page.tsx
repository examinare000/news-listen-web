import Link from 'next/link'
import { BrandLogo } from '@/components/ui/BrandLogo'

export const metadata = {
  title: 'プライバシーポリシー | NewsListen',
  description: 'NewsListenのプライバシーポリシー',
}

export default function PrivacyPage() {
  return (
    <div className="lp-page">
      <header className="lp-header">
        <Link href="/">
          <BrandLogo />
        </Link>
      </header>

      <div className="legal-content">
        <h1>プライバシーポリシー</h1>

        <section>
          <h2>本ポリシーについて</h2>
          <p>
            NewsListen（以下、「本サービス」）は、ユーザーの個人情報を大切に扱います。
            本ポリシーでは、本サービスがいかなる情報を収集し、どのように処理するかを説明します。
          </p>
        </section>

        <section>
          <h2>収集する情報</h2>
          <h3>認証情報</h3>
          <p>
            アカウント登録時に、ユーザーID、表示名、メールアドレス（任意・パスワードリセット用）を収集します。
            パスワードはハッシュ化して保存され、運営者が復号することはできません。
            パスキーを登録した場合、その公開鍵情報を保存します。
          </p>

          <h3>学習・再生データ</h3>
          <p>
            本サービスは、以下のデータを記録します：
          </p>
          <ul>
            <li>ユーザーが登録したRSSフィード</li>
            <li>スター（お気に入り）をつけた記事</li>
            <li>生成されたポッドキャストの再生履歴および再生位置</li>
            <li>リスニング時間、学習進捗</li>
            <li>ユーザーが選択した難易度設定</li>
          </ul>

          <h3>ブラウザストレージ</h3>
          <p>
            再生位置、テーマ設定、ユーザーの一時的な状態管理のためにローカルストレージを使用します。
          </p>
        </section>

        <section>
          <h2>外部サービスへの情報送信</h2>
          <h3>Google Cloud Platform</h3>
          <p>
            本サービスは、Google Cloud Platform上で運営されています。以下のサービスを利用しています：
          </p>
          <ul>
            <li><strong>Firestore</strong>: ユーザーアカウント、フィード、ポッドキャスト、再生履歴などの保存</li>
            <li><strong>Cloud Storage</strong>: 生成された音声ファイルの保存</li>
            <li><strong>Text-to-Speech API</strong>: 生成されたポッドキャスト台本の音声化</li>
          </ul>

          <h3>Google Gemini API</h3>
          <p>
            本サービスは、ユーザーが登録したRSSフィードから取得した記事本文をGoogle Gemini APIに送信し、
            ポッドキャスト用の台本を生成します。
            送信される情報には、記事のタイトル、本文、およびユーザーが選択した難易度が含まれます。
          </p>
        </section>

        <section>
          <h2>データ保持と削除</h2>
          <h3>アカウント消去</h3>
          <p>
            ユーザーがアカウントを削除した場合、以下のデータが削除されます：
          </p>
          <ul>
            <li>ユーザーアカウント（ユーザーID、認証情報、パスキー）</li>
            <li>ユーザーが登録したフィード、スター、再生履歴、学習進捗、語彙帳、設定</li>
            <li>ユーザー向けに生成されたポッドキャスト</li>
          </ul>

          <h3>保持されるデータ</h3>
          <p>
            収集した記事本文、および複数ユーザーが共有するポッドキャストキャッシュは、
            特定ユーザーの個人データではないシステム共有データとして保持されます。
            また、不正調査のためのセキュリティ監査記録は追記型の証跡として保持されます。
          </p>
        </section>

        <section>
          <h2>セキュリティ</h2>
          <p>
            本サービスは、Google Cloudのセキュリティ機構により保護されています。
            ユーザーの認証情報と個人データは、暗号化により保護されます。
          </p>
        </section>

        <section>
          <h2>お問い合わせ</h2>
          <p>
            プライバシーに関するご質問・ご懸念については、以下のメールアドレスまでお問い合わせください：
          </p>
          <p>
            <a href="mailto:examinare000@gmail.com">examinare000@gmail.com</a>
          </p>
        </section>

        <section>
          <h2>ポリシー変更</h2>
          <p>
            本ポリシーは予告なく変更されることがあります。
            変更後のサービス利用をもって、新ポリシーに同意したものとみなします。
          </p>
        </section>

        <section className="legal-footer">
          <p>最終更新日: 2026-08-29</p>
        </section>
      </div>
    </div>
  )
}
