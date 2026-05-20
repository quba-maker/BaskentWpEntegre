import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[--q-light-bg]">
      <div className="animate-pulse flex flex-col items-center">
        <div className="w-12 h-12 bg-black/5 rounded-xl flex items-center justify-center mb-4">
          <Loader2 className="w-6 h-6 text-black/20 animate-spin" />
        </div>
        <h2 className="text-[15px] font-medium text-[--q-text-secondary]">Çalışma alanı yükleniyor...</h2>
      </div>
    </div>
  );
}
