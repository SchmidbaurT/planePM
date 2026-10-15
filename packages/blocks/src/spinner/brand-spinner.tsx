import { brandMark } from "../brand";

export function BrandSpinner({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="schmidbaur-loader" role="status" aria-label={label}>
      <img src={brandMark} width={192} height={192} alt="" aria-hidden="true" />
    </div>
  );
}
