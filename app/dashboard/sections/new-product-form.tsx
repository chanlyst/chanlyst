import { useState } from "react";
import { words, type Locale } from "../i18n";
import {
  blankProduct,
  mergePrefillFields,
  type BusyState,
  type PrefillFields,
  type Product,
} from "../types";

export default function NewProductForm({
  locale,
  busy,
  onSave,
  onPrefill,
}: {
  locale: Locale;
  busy: BusyState;
  onSave: (product: Product) => Promise<boolean>;
  onPrefill: (url: string) => Promise<PrefillFields | null>;
}) {
  const [product, setProduct] = useState<Product>(blankProduct);
  const [prefillUrl, setPrefillUrl] = useState("");
  const t = words[locale];
  async function prefill() {
    const url = prefillUrl.trim();
    if (!url) return;
    const fields = await onPrefill(url);
    if (!fields) return;
    // Only empty fields are filled: whatever the user already typed wins.
    setProduct((current) => {
      const merged = mergePrefillFields(current, fields);
      return merged.website.trim() ? merged : { ...merged, website: url };
    });
  }
  return <div className="new-form">
    <label><span>{t.prefillLabel}</span><div className="prefill-row"><input placeholder="https://…" value={prefillUrl} onChange={(event) => setPrefillUrl(event.target.value)} /><button className="outline" disabled={busy === "prefill" || !prefillUrl.trim()} onClick={prefill}>{busy === "prefill" ? t.prefillRunning : t.prefillButton}</button></div></label>
    <label><span>{t.name}</span><input autoFocus value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></label>
    <label><span>{t.website}</span><input placeholder="https://…" value={product.website} onChange={(event) => setProduct({ ...product, website: event.target.value })} /></label>
    <label><span>{t.description}</span><textarea value={product.description} onChange={(event) => setProduct({ ...product, description: event.target.value })} /></label>
    <div><label><span>{t.geography}</span><input value={product.geography} onChange={(event) => setProduct({ ...product, geography: event.target.value })} /></label><label><span>{t.languages}</span><input value={product.languages} onChange={(event) => setProduct({ ...product, languages: event.target.value })} /></label></div>
    <div><label><span>{t.paidOffer}</span><input value={product.paidOffer} onChange={(event) => setProduct({ ...product, paidOffer: event.target.value })} /></label><label><span>{t.paymentPoint}</span><input value={product.paymentPoint} onChange={(event) => setProduct({ ...product, paymentPoint: event.target.value })} /></label></div>
    <div><label><span>{t.conversionEvent}</span><input value={product.conversionEvent} onChange={(event) => setProduct({ ...product, conversionEvent: event.target.value })} /></label><label><span>{t.partnerTerms}</span><input value={product.partnerTerms} onChange={(event) => setProduct({ ...product, partnerTerms: event.target.value })} /></label></div>
    <button className="lime" disabled={!product.name.trim()} onClick={() => onSave(product)}>{t.save}</button>
    <p className="new-form-hint">{t.newProductPassportHint}</p>
  </div>;
}
