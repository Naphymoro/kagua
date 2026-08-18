import { signIn } from "@/auth";

export default function Page() {
  return <main className="shell"><section className="hero"><div className="eyebrow">AIMS RIC ACCESS</div><h1>Sign in to <em>Kagua.</em></h1><p>Kagua is currently restricted to Google accounts whose verified email ends in <strong>@aimsric.org</strong>.</p></section><section className="card" style={{maxWidth:520,margin:"0 auto 4rem",padding:"2rem"}}><h2>Continue with your AIMS RIC account</h2><p>No separate Kagua password is required.</p><form action={async()=>{"use server";await signIn("google",{redirectTo:"/"})}}><button className="primary" type="submit">Sign in with Google</button></form><p className="evidence">Personal Gmail and other institutional domains are not permitted.</p></section></main>;
}
