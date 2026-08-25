import { AppTopBar } from '../../chrome';
import { BrandingForm } from './branding-form';

export default function BrandingPage() {
  return (
    <div className="rs-shell">
      <AppTopBar active="branding" />
      <main className="rs-main" style={{ maxWidth: 640 }}>
        <BrandingForm />
      </main>
    </div>
  );
}
