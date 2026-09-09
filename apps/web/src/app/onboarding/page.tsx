"use client";

import { useState } from "react";
import { Button, TextField } from "../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function OnboardingPage() {
  const [businessName, setBusinessName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [locationName, setLocationName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    // Business identity and location go straight to apps/api, which
    // creates the merchant, assigns this account OWNER, and creates the
    // first location in one step — no separate confirmation round trip.
    const response = await fetch(`${API_BASE_URL}/merchants`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessName,
        legalName,
        taxId,
        defaultCurrency,
        businessAddress: { addressLine1, city, state: state || undefined, postalCode, country },
        location: { name: locationName, timezone },
      }),
    });

    setSubmitting(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
      setError(body.detail ?? body.title ?? "Setup failed.");
      return;
    }

    const body = (await response.json()) as { merchantId: string };
    // The next step is payouts onboarding (D104) — a brand-new merchant
    // can't accept a real payment until Stripe Connect is set up.
    window.location.href = `/dashboard/payments?merchantId=${body.merchantId}`;
  }

  return (
    <main>
      <h1>Set up your business</h1>
      <form onSubmit={handleSubmit}>
        <TextField
          label="Business name"
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
          required
        />
        <TextField
          label="Legal business name"
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          required
        />
        <TextField label="Tax ID" value={taxId} onChange={(event) => setTaxId(event.target.value)} required />
        <TextField
          label="Default currency"
          value={defaultCurrency}
          onChange={(event) => setDefaultCurrency(event.target.value)}
          required
        />
        <TextField
          label="Business address"
          value={addressLine1}
          onChange={(event) => setAddressLine1(event.target.value)}
          required
        />
        <TextField label="City" value={city} onChange={(event) => setCity(event.target.value)} required />
        <TextField label="State / province" value={state} onChange={(event) => setState(event.target.value)} />
        <TextField
          label="Postal code"
          value={postalCode}
          onChange={(event) => setPostalCode(event.target.value)}
          required
        />
        <TextField label="Country" value={country} onChange={(event) => setCountry(event.target.value)} required />
        <TextField
          label="First location name"
          value={locationName}
          onChange={(event) => setLocationName(event.target.value)}
          required
        />
        <TextField
          label="Timezone"
          placeholder="America/Chicago"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          required
        />
        <Button type="submit" disabled={submitting}>
          Finish setup
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
