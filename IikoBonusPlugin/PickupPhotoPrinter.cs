using System;
using System.Collections.Generic;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class PickupPhotoPrinterSelection
    {
        internal IPrinterQueueRef Printer {get;}
        internal int WidthDots {get;}
        internal string Kind {get;}
        internal PickupPhotoPrinterSelection(IPrinterQueueRef printer,int widthDots,string kind)
        {Printer=printer;WidthDots=widthDots;Kind=kind;}
    }

    internal static class PickupPhotoPrinter
    {
        internal static bool TrySelect(IOperationService os,out PickupPhotoPrinterSelection selected,out string reason)
        {
            selected=null;reason="not_configured";
            int requested;
            try {requested=PickupPhotoRaster.WidthDots;}
            catch {reason="invalid_width";return false;}
            var seen=new HashSet<Guid>();
            foreach(var kind in new[]{"receipt","bill","document"})
            {
                try
                {
                    var printer=kind=="receipt" ? os.TryGetReceiptChequePrinter(true)
                        : kind=="bill" ? os.TryGetBillPrinter(null,true) : os.TryGetDocumentPrinter(null,true);
                    if(printer==null || !seen.Add(printer.Id)) continue;
                    var device=os.TryGetPrintingDeviceInfoById(printer.Id);
                    if(device==null) {reason="driver_unavailable";continue;}
                    var parameters=os.GetPrinterDriverParameters(device);
                    if(parameters==null) {reason="driver_unavailable";continue;}
                    if(!parameters.CanPrintImage) {reason="image_unsupported";continue;}
                    // Unknown page width never authorizes a wider 576-dot image.
                    var width=384;
                    if(parameters.PageWidth.HasValue)
                    {
                        var printable=(long)parameters.PageWidth.Value-Math.Max(0,parameters.MarginLeft)-Math.Max(0,parameters.MarginRight);
                        if(printable<384) {reason="paper_too_narrow";continue;}
                        if(requested==576 && printable>=576) width=576;
                    }
                    selected=new PickupPhotoPrinterSelection(printer,width,kind);reason="ready";return true;
                }
                catch {reason="driver_unavailable";}
            }
            return false;
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
                case "journal_unhealthy": return "Фото в подарок: журнал требует сверки";
                case "queue_full": return "Фото в подарок: требуется сверка незавершённых заданий";
                case "print_in_progress": return "Фото в подарок: ожидаем завершения печати";
                case "stopped": return "Фото в подарок: обработчик остановлен";
                default: return "Фото в подарок: настройте принтер чеков, пречеков или документов";
            }
        }
    }
}
