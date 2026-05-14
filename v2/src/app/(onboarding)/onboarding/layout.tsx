export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-50 selection:bg-blue-500/30">
      {children}
    </div>
  );
}
