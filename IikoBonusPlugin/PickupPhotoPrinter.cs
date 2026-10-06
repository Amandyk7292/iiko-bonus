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
            if(PickupPhotoReceiptRoute.TryResolve(os,out var receipt,out var receiptDiagnostic))
            {
                var receiptReady=PrepareReceipt(os,receipt,out selected,out reason,out var receiptFailure);
                lock(diagnosticGate) readinessDiagnostic=receiptReady ? null : receiptFailure;
                return receiptReady;
            }
            if(!PickupPhotoRoutes.TryDefaultDevice(os,out var deviceId,out reason,out var kind))
            {
                var routeDiagnostic=PickupPhotoRoutes.DiagnosticStatus ?? receiptDiagnostic;
                lock(diagnosticGate) readinessDiagnostic=routeDiagnostic;
                return false;
            }
            var ready=PrepareDevice(os,deviceId,out selected,out reason,out var diagnostic);
            if(ready && kind=="receipt")
            {
                ready=UseReceiptSelection(os,ref selected,out reason);
                if(!ready && reason=="driver_unavailable") diagnostic="receipt_terminal_failed";
            }
            lock(diagnosticGate) readinessDiagnostic=ready ? null : diagnostic;
            return ready;
        }
        internal static bool TrySelectForOrder(IOperationService os,string orderId,string photoId,long number,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            if(!PickupPhotoRoutes.TryOrderDevice(os,orderId,photoId,number,out var deviceId,out reason)) return false;
            return PreparePinned(os,orderId,deviceId,out selected,out reason);
        }
        internal static bool TryPrepareForOrder(IOperationService os,Resto.Front.Api.Data.Print.IPrinterQueueRef queue,
            string orderId,Guid frontOrderId,string photoId,long number,out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            if(PickupPhotoRoutes.TryOrderDevice(os,orderId,photoId,number,out var existing,out reason))
            {
                if(PickupPhotoRoutes.HasReceiptBinding(os,orderId))
                    return PrepareReceiptOrder(os,orderId,frontOrderId,photoId,number,out selected,out reason);
                if(PickupPhotoRoutes.HasReceiptQueueBinding(os,orderId))
                {
                    if(!PickupPhotoRoutes.TryQueueDevice(os,queue,out var current,out reason)) return false;
                    if(current!=existing) {reason="device_unmapped";return false;}
                }
                return PickupPhotoRoutes.ReserveOrder(os,queue,orderId,frontOrderId,photoId,number,existing,out reason)
                    && PrepareQueueDevice(os,queue,existing,out selected,out reason);
            }
            if(PickupPhotoReceiptRoute.TryResolve(os,out var receipt,out _))
            {
                if(!PrepareReceipt(os,receipt,out selected,out reason,out _)) return false;
                if(PickupPhotoRoutes.ReserveReceiptOrder(os,receipt,orderId,frontOrderId,photoId,number,out reason)) return true;
                selected=null;return false;
            }
            if(!PickupPhotoRoutes.TryQueueDevice(os,queue,out var device,out reason)
                || !PrepareQueueDevice(os,queue,device,out selected,out reason)) return false;
            if(!PickupPhotoRoutes.ReserveOrder(os,queue,orderId,frontOrderId,photoId,number,device,out reason)) {selected=null;return false;}
            return true;
        }
        internal static bool TryPrepareForOrder(IOperationService os,Resto.Front.Api.Data.Orders.IOrder order,
            string orderId,string photoId,long number,out PickupPhotoPrinterSelection selected,
            out Resto.Front.Api.Data.Print.IPrinterQueueRef queue,out string reason)
        {
            selected=null;queue=null;reason="device_unmapped";
            // A durable legacy reservation takes precedence over a newly
            // configured receipt target. Never migrate an outstanding photo.
            if(PickupPhotoRoutes.TryOrderDevice(os,orderId,photoId,number,out _,out _))
            {
                if(PickupPhotoRoutes.HasReceiptBinding(os,orderId))
                    return PrepareReceiptOrder(os,orderId,order.Id,photoId,number,out selected,out reason);
            }
            else if(PickupPhotoReceiptRoute.TryResolve(os,out var receipt,out _))
            {
                if(!PrepareReceipt(os,receipt,out selected,out reason,out _)) return false;
                if(PickupPhotoRoutes.ReserveReceiptOrder(os,receipt,orderId,order.Id,photoId,number,out reason)) return true;
                selected=null;return false;
            }
            try
            {
                var source=PickupPhotoRoutes.BindingKind(os,orderId);
                // Existing bill/document reservations retain their original
                // section route even when a receipt printer was added later.
                queue=source=="bill" || source=="document" ? AssemblyTicket.Printer(os,order)
                    : PickupPhotoRoutes.ConfiguredReceiptQueue(os);
                if(queue==null)
                {
                    if(source=="receipt_queue") return false;
                    queue=AssemblyTicket.Printer(os,order);
                }
            }
            catch {reason="not_configured";return false;}
            return TryPrepareForOrder(os,queue,orderId,order.Id,photoId,number,out selected,out reason);
        }
        private static bool PrepareReceiptOrder(IOperationService os,string orderId,Guid frontOrderId,string photoId,long number,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;reason="device_unmapped";
            if(!PickupPhotoReceiptRoute.TryResolve(os,out var receipt,out _)
                || !PrepareReceipt(os,receipt,out selected,out reason,out _)) return false;
            if(PickupPhotoRoutes.ReserveReceiptOrder(os,receipt,orderId,frontOrderId,photoId,number,out reason)) return true;
            selected=null;return false;
        }
        private static bool PreparePinned(IOperationService os,string orderId,Guid deviceId,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            if(PickupPhotoRoutes.TryReceiptBinding(os,orderId,out var receipt))
            {
                if(receipt.Device!=deviceId) {selected=null;reason="device_unmapped";return false;}
                return PrepareReceipt(os,receipt,out selected,out reason,out _);
            }
            if(!PrepareDevice(os,deviceId,out selected,out reason)) return false;
            return !PickupPhotoRoutes.HasReceiptQueueBinding(os,orderId) || UseReceiptSelection(os,ref selected,out reason);
        }
        private static bool PrepareQueueDevice(IOperationService os,Resto.Front.Api.Data.Print.IPrinterQueueRef queue,Guid device,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            if(!PrepareDevice(os,device,out selected,out reason)) return false;
            return !PickupPhotoRoutes.IsReceiptQueue(queue) || UseReceiptSelection(os,ref selected,out reason);
        }
        private static bool UseReceiptSelection(IOperationService os,ref PickupPhotoPrinterSelection selected,out string reason)
        {
            reason="printer_not_local";
            try
            {
                if(selected?.Printer.RelatedTerminal==null || selected.Printer.RelatedTerminal.Id!=os.GetHostTerminal().Id)
                    {selected=null;return false;}
                selected=new PickupPhotoPrinterSelection(selected.Printer,selected.WidthDots,"receipt");reason="ready";return true;
            }
            catch(Exception error)
            {
                Diagnose("receipt_terminal",selected?.Printer.Id,error.GetType().Name);
                selected=null;reason="driver_unavailable";return false;
            }
        }
        private static bool PrepareReceipt(IOperationService os,PickupPhotoReceiptRoute receipt,
            out PickupPhotoPrinterSelection selected,out string reason,out string diagnostic)
        {
            selected=null;diagnostic=null;reason="driver_unavailable";
            if(!PickupPhotoRoutes.CanUseReceiptRoute(out reason)) return false;
            try
            {
                if(receipt.Generation!=PickupPhotoRoutes.ReceiptGeneration || receipt.Branch!=LoyaltyFlow.BranchId
                    || receipt.Terminal!=os.GetHostTerminal().Id.ToString()) {reason="device_unmapped";return false;}
                var device=os.TryGetPrintingDeviceInfoById(receipt.Device);
                if(device==null || device.Id!=receipt.Device) {reason="device_unmapped";diagnostic="receipt_device_missing";return false;}
                if(device.RelatedTerminal==null || device.RelatedTerminal.Id.ToString()!=receipt.Terminal)
                    {reason="printer_not_local";diagnostic="receipt_device_not_local";return false;}
                int requested;
                try {requested=PickupPhotoRaster.WidthDots;}
                catch {reason="invalid_width";return false;}
                if(!TryPrepare(os,device,requested,out var physical,out reason,out diagnostic)) return false;
                if(!PickupPhotoRoutes.CanUseReceiptRoute(out reason) || receipt.Generation!=PickupPhotoRoutes.ReceiptGeneration)
                    {reason="device_unmapped";return false;}
                selected=new PickupPhotoPrinterSelection(physical.Printer,physical.WidthDots,"receipt");reason="ready";return true;
            }
            catch(Exception error) {reason="driver_unavailable";diagnostic="receipt_device_failed type="+error.GetType().Name;return false;}
        }
        internal static bool TrySelectForRecovery(IOperationService os,string orderId,Guid frontOrderId,string photoId,long number,
            out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;
            return PickupPhotoRoutes.TryRecoveryDevice(os,orderId,frontOrderId,photoId,number,out var device,out reason)
                && PreparePinned(os,orderId,device,out selected,out reason);
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
