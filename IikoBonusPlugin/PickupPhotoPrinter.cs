using System;
using System.Collections.Generic;
using System.Linq;
using Resto.Front.Api.Data.Device;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class PickupPhotoPrinterSelection
    {
        internal IPrintingDeviceInfo Printer {get;}
        internal int WidthDots {get;}
        internal string Kind {get;}
        internal PickupPhotoPrinterSelection(IPrintingDeviceInfo printer,int widthDots,string kind)
        {Printer=printer;WidthDots=widthDots;Kind=kind;}
    }

    internal static class PickupPhotoPrinter
    {
        private static readonly object diagnosticGate=new object();
        private static readonly Dictionary<string,string> diagnostics=new Dictionary<string,string>();
        private static string readinessDiagnostic;
        internal static string ReadinessDiagnostic {get {lock(diagnosticGate) return readinessDiagnostic;}}
        internal static void Diagnose(string stage,Guid? deviceId,string detail)
        {
            // Fixed stages, device UUIDs, numeric driver flags and exception types only.
            // Do not log raw SDK messages, names, configuration or customer information.
            var key=stage+":"+(deviceId?.ToString() ?? "none");
            lock(diagnosticGate)
            {
                if(diagnostics.TryGetValue(key,out var previous) && previous==detail) return;
                if(diagnostics.Count>=128) diagnostics.Clear();
                diagnostics[key]=detail;
            }
            try {PluginContext.Log.Info("Bulka photo printer "+key+" "+detail);} catch { }
        }
        private static bool TryPrepare(IOperationService os,IPrintingDeviceInfo device,int requested,
            out PickupPhotoPrinterSelection selected,out string reason,out string diagnostic)
        {
            selected=null;reason="driver_unavailable";diagnostic=null;
            try
            {
                var parameters=os.GetPrinterDriverParameters(device);
                if(parameters==null) {diagnostic="physical_parameters_missing";Diagnose("parameters",device.Id,"null");return false;}
                Diagnose("parameters",device.Id,"image="+parameters.CanPrintImage+" width="+parameters.PageWidth+
                    " left="+parameters.MarginLeft+" right="+parameters.MarginRight);
                if(!parameters.CanPrintImage) {reason="image_unsupported";return false;}
                var width=384;
                if(parameters.PageWidth.HasValue)
                {
                    var printable=(long)parameters.PageWidth.Value-Math.Max(0,parameters.MarginLeft)-Math.Max(0,parameters.MarginRight);
                    if(printable<384) {reason="paper_too_narrow";return false;}
                    if(requested==576 && printable>=576) width=576;
                }
                selected=new PickupPhotoPrinterSelection(device,width,"device");reason="ready";return true;
            }
            catch(Exception error) {diagnostic="physical_parameters_failed type="+error.GetType().Name;Diagnose("parameters",device.Id,error.GetType().Name);return false;}
        }
        private static bool PrepareDevice(IOperationService os,Guid deviceId,out PickupPhotoPrinterSelection selected,out string reason)
            => PrepareDevice(os,deviceId,out selected,out reason,out _);
        private static bool PrepareDevice(IOperationService os,Guid deviceId,out PickupPhotoPrinterSelection selected,out string reason,out string diagnostic)
        {
            selected=null;reason="driver_unavailable";diagnostic=null;
            int requested;
            try {requested=PickupPhotoRaster.WidthDots;}
            catch {reason="invalid_width";return false;}
            try
            {
                // Only an observed physical UUID is authoritative. Inventory is
                // used for an exact lookup, never to choose an unrelated printer.
                var devices=os.GetPrintingDeviceInfos();
                if(devices==null) {diagnostic="physical_inventory_missing";Diagnose("inventory",deviceId,"null");return false;}
                var device=devices.FirstOrDefault(item=>item!=null && item.Id==deviceId);
                if(device==null) {reason="device_unmapped";diagnostic="physical_device_missing";Diagnose("observed_device",deviceId,"not_found");return false;}
                return TryPrepare(os,device,requested,out selected,out reason,out diagnostic);
            }
            catch(Exception error) {diagnostic="physical_inventory_failed type="+error.GetType().Name;Diagnose("observed_device",deviceId,error.GetType().Name);return false;}
        }
        internal static bool TrySelect(IOperationService os,out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            if(!PickupPhotoRoutes.TryDefaultDevice(os,out var deviceId,out reason))
            {
                var routeDiagnostic=PickupPhotoRoutes.DiagnosticStatus;
                lock(diagnosticGate) readinessDiagnostic=routeDiagnostic;
                return false;
            }
            var ready=PrepareDevice(os,deviceId,out selected,out reason,out var diagnostic);
            lock(diagnosticGate) readinessDiagnostic=ready ? null : diagnostic;
            return ready;
        }
        internal static bool TrySelectForOrder(IOperationService os,string orderId,string photoId,long number,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            if(!PickupPhotoRoutes.TryOrderDevice(os,orderId,photoId,number,out var deviceId,out reason)) return false;
            return PrepareDevice(os,deviceId,out selected,out reason);
        }
        internal static bool TryPrepareForOrder(IOperationService os,Resto.Front.Api.Data.Print.IPrinterQueueRef queue,
            string orderId,Guid frontOrderId,string photoId,long number,out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            if(PickupPhotoRoutes.TryOrderDevice(os,orderId,photoId,number,out var existing,out reason))
                return PickupPhotoRoutes.ReserveOrder(os,queue,orderId,frontOrderId,photoId,number,existing,out reason)
                    && PrepareDevice(os,existing,out selected,out reason);
            if(!PickupPhotoRoutes.TryQueueDevice(os,queue,out var device,out reason)
                || !PrepareDevice(os,device,out selected,out reason)) return false;
            if(!PickupPhotoRoutes.ReserveOrder(os,queue,orderId,frontOrderId,photoId,number,device,out reason)) {selected=null;return false;}
            return true;
        }
        internal static bool TrySelectForRecovery(IOperationService os,string orderId,Guid frontOrderId,string photoId,long number,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            return PickupPhotoRoutes.TryRecoveryDevice(os,orderId,frontOrderId,photoId,number,out var device,out reason)
                && PrepareDevice(os,device,out selected,out reason);
        }
        internal static string StatusMessage(string status)
        {
            switch(status)
            {
                case "ready": return "Фото в подарок: принтер готов";
                case "image_unsupported": return "Фото в подарок: драйвер принтера не поддерживает изображения";
                case "paper_too_narrow": return "Фото в подарок: недостаточная ширина ленты";
                case "invalid_width": return "Фото в подарок: ширина должна быть 384 или 576 точек";
                case "driver_unavailable": return "Фото в подарок: параметры принтера недоступны";
                case "ambiguous_printer": return "Фото в подарок: очередь направляет чек на разные принтеры";
                case "device_unmapped": return "Фото в подарок: ожидаем подтверждение принтера сборочного чека";
                case "printer_not_local": return "Фото в подарок: принтер не подключён к этой кассе";
                case "invalid_printer_id": return "Фото в подарок: неверный ID принтера в настройках";
                case "journal_unhealthy": return "Фото в подарок: журнал требует сверки";
                case "queue_full": return "Фото в подарок: требуется сверка незавершённых заданий";
                case "print_in_progress": return "Фото в подарок: ожидаем завершения печати";
                case "stopped": return "Фото в подарок: обработчик остановлен";
                default: return "Фото в подарок: настройте принтер чеков, пречеков или документов";
            }
        }
    }
}
