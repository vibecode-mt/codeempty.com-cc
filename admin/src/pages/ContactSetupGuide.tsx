export default function ContactSetupGuide() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Contact Form Setup Guide</h1>
        <p className="text-sm text-gray-500 mt-1">
          Primary recommendation: Amazon SES via a webhook endpoint. This guide also includes alternatives and captcha setup.
        </p>
      </div>

      <section className="bg-white border rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-semibold">1. Recommended: Amazon SES via Webhook Endpoint</h2>
        <p className="text-sm text-gray-600">
          In this CMS, contact form delivery uses an HTTP webhook. The easiest SES path is:
          Contact Widget → <strong>Webhook URL</strong> → AWS API Gateway/Lambda → SES SendEmail.
        </p>
        <ol className="list-decimal ml-5 space-y-2 text-sm text-gray-700">
          <li>Create an SES identity (domain/email) and verify it.</li>
          <li>Create an IAM user/role with SES send permissions only.</li>
          <li>Create a Lambda function that accepts JSON and calls SES SendEmail/SendRawEmail.</li>
          <li>Expose Lambda through API Gateway (HTTPS URL).</li>
          <li>Protect the endpoint with an auth token (e.g., Authorization header).</li>
          <li>In <code>/admin/settings</code> → Contact Form:
            <ul className="list-disc ml-5 mt-1">
              <li>Delivery provider: <strong>Webhook</strong></li>
              <li>Webhook URL: your API Gateway URL</li>
              <li>Auth header: <code>Bearer ...</code> (or your expected token)</li>
              <li>To email / From email: destination + sender identity</li>
            </ul>
          </li>
        </ol>
      </section>

      <section className="bg-white border rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-semibold">2. Other Webhook Providers</h2>
        <p className="text-sm text-gray-600">
          You can route webhook payloads to any provider that can send email:
        </p>
        <ul className="list-disc ml-5 space-y-1 text-sm text-gray-700">
          <li>Resend API endpoint</li>
          <li>SendGrid API endpoint</li>
          <li>Mailgun API endpoint</li>
          <li>Zapier / Make / Pipedream workflow endpoint</li>
          <li>Custom backend endpoint (Node, Python, Go, etc.)</li>
        </ul>
        <p className="text-sm text-gray-600">
          Expected payload includes: event name, to/from email, field values, source page slug, user-agent, timestamp.
        </p>
      </section>

      <section className="bg-white border rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-semibold">3. Captcha Setup</h2>
        <div className="space-y-3 text-sm text-gray-700">
          <div>
            <h3 className="font-semibold">Cloudflare Turnstile (recommended)</h3>
            <ol className="list-decimal ml-5 mt-1 space-y-1">
              <li>Create a Turnstile site in Cloudflare Dashboard.</li>
              <li>Add your production + localhost domains.</li>
              <li>Copy Site Key and Secret Key into Contact Form settings.</li>
              <li>Enable captcha and select <strong>Turnstile</strong>.</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold">Google reCAPTCHA v2</h3>
            <ol className="list-decimal ml-5 mt-1 space-y-1">
              <li>Create v2 checkbox keys in Google reCAPTCHA admin.</li>
              <li>Add your domains.</li>
              <li>Paste Site Key + Secret Key in Contact Form settings.</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold">Google reCAPTCHA v3</h3>
            <ol className="list-decimal ml-5 mt-1 space-y-1">
              <li>Create v3 score-based keys in Google reCAPTCHA admin.</li>
              <li>Add your domains.</li>
              <li>Paste Site Key + Secret Key in Contact Form settings.</li>
              <li>Set action (e.g., <code>contact_submit</code>) and min score (e.g., 0.5).</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-xl p-6 space-y-2">
        <h2 className="text-lg font-semibold">4. Notes</h2>
        <ul className="list-disc ml-5 space-y-1 text-sm text-gray-700">
          <li>Contact submissions are saved in D1 (<code>contact_submissions</code>), even when delivery fails.</li>
          <li>Use HTTPS endpoints only.</li>
          <li>Rotate webhook auth tokens and provider credentials regularly.</li>
        </ul>
      </section>
    </div>
  );
}
