export default function OfflinePage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Offline</h1>
        <p className="text-muted-foreground mb-4">
          You&apos;re offline. Check your connection and try again.
        </p>
        <p className="text-sm text-muted-foreground">
          You can still play cached tracks if available.
        </p>
      </div>
    </div>
  );
}
