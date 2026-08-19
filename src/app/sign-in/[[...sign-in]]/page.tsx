import Link from "next/link";
import { googleOAuthReady, localAuthBypass, signIn } from "@/auth";

export default function Page() {
  return <main className="authShell">
    <section className="authIntro">
      <div className="authBadge">AIMS RIC ACCESS</div>
      <div className="authMark">K</div>
      <h1>Welcome to <span>Kagua</span></h1>
      <p>Scientific publication intelligence for evidence-grounded journal selection.</p>
    </section>

    <section className="authCard" aria-labelledby="signin-title">
      <div className="authCardHeader">
        <span className="authKicker">SECURE SIGN-IN</span>
        <h2 id="signin-title">Continue with your AIMS RIC account</h2>
        <p>Use your verified institutional Google account. No separate Kagua password is required.</p>
      </div>

      {googleOAuthReady ? <form action={async()=>{"use server";await signIn("google",{redirectTo:"/"})}}>
          <button className="googleSignIn" type="submit">
            <span className="googleGlyph" aria-hidden="true">G</span>
            <span>Continue with Google</span>
          </button>
        </form> :
        <div className="authSetupWarning">
          <b>Google sign-in is not configured</b>
          <small>Set <code>AUTH_GOOGLE_ID</code> and <code>AUTH_GOOGLE_SECRET</code> in the deployment environment.</small>
          {localAuthBypass && <Link className="authLocalPreview" href="/">Open local preview</Link>}
        </div>}

      <div className="authDomainRule">
        <span className="authRuleDot" aria-hidden="true"/>
        <div><b>Institutional access only</b><small>Only verified email addresses ending in @aimsric.org can enter Kagua.</small></div>
      </div>
    </section>

    <p className="authPrivacy">Authentication is handled by Google. Kagua does not store your Google password.</p>
  </main>;
}
