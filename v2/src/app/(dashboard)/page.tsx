export default function DashboardPage() {
  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Sisteminizin genel durumunu buradan izleyebilirsiniz.</p>
      </div>
      
      <div className="flex-1 flex items-center justify-center border-2 border-dashed border-border rounded-lg bg-sidebar/50">
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground">Dashboard bileşenleri buraya gelecek.</p>
        </div>
      </div>
    </div>
  );
}
