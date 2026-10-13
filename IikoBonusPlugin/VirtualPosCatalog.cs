using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Device;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Organization.Sections;
using Resto.Front.Api.Data.Payments;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class VirtualPosCatalog
    {
        internal static string Hash(string text)
        {
            using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();
        }
        internal static string Json(object value)
        {
            using(var stream=new MemoryStream())
            {
                new DataContractJsonSerializer(value.GetType()).WriteObject(stream,value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        internal static bool ValidQuantity(decimal quantity,decimal step) => quantity>0 && quantity<=9999m
            && (step==1m || step==0.001m) && quantity%step==0;
        private static string DisplayName(string value,string fallback,int maximum)
        {
            var text=string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
            return text.Substring(0,Math.Min(maximum,text.Length));
        }
        private static string Setting(string key) => LoyaltyFlow.ReadPluginSetting("IIKO_VIRTUAL_POS_"+key);
        internal static HashSet<Guid> PaymentAllowlist()
        {
            var result=new HashSet<Guid>();
            foreach(var raw in (Setting("PAYMENT_TYPE_IDS") ?? "").Split(','))
                if(Guid.TryParse(raw.Trim(),out var id) && id!=Guid.Empty) result.Add(id);
            return result;
        }
        internal static ITable Table(IOperationService os)
        {
            if(!Guid.TryParse(Setting("TABLE_ID"),out var id)) return null;
            var sections=os.GetHostTerminalRestaurantSections().Select(s=>s.Id).ToArray();
            return os.GetTables(false).SingleOrDefault(t=>t.Id==id && t.IsActive && sections.Contains(t.RestaurantSection.Id));
        }
        internal static IPointOfSale PointOfSale(IOperationService os)
        {
            var points=os.GetHostTerminalPointsOfSale();
            // The SDK receipt printer query uses the default register. Keep a
            // single unambiguous native cash register in this first version.
            return points.Count==1 ? points[0] : null;
        }
        internal static bool FrontOrderPrintDisabled(string path)
        {
            if(string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || !File.Exists(path)) return false;
            try
            {
                var settings=new XmlReaderSettings {DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null};
                using(var reader=XmlReader.Create(path,settings))
                {
                    var doc=XDocument.Load(reader);
                    var entries=doc.Descendants().Where(e=>e.Name.LocalName=="EnableOrderPrint").ToList();
                    return entries.Count==1 && bool.TryParse(entries[0].Value.Trim(),out var enabled) && !enabled;
                }
            }
            catch(IOException) {return false;}
            catch(UnauthorizedAccessException) {return false;}
            catch(XmlException) {return false;}
        }
        internal static string NoPaperProblem(IOperationService os,IPointOfSale point,ITable table)
        {
            if(!string.Equals(Setting("NO_PAPER_VERIFIED"),"true",StringComparison.OrdinalIgnoreCase))
                return "Для этой кассы не подтверждена регистрация продаж без фискализации и бумаги.";
            if(!Guid.TryParse(Setting("TERMINAL_ID"),out var terminal) || terminal!=os.GetHostTerminal().Id)
                return "Профиль без бумаги относится к другой кассе.";
            if(point?.CashRegister==null || !Guid.TryParse(Setting("CASH_REGISTER_ID"),out var register) || register!=point.CashRegister.Id)
                return "Нужна одна настроенная касса iiko с подтверждённым профилем без бумаги.";
            if(table==null) return "Для кассы не настроен отдельный активный стол продаж Bulka.";
            if(!point.CashRegister.IsVirtual || point.CashRegister.VirtualChequePrinterId.HasValue || os.TryGetReceiptChequePrinter(true)!=null)
                return "У кассы есть печатающий регистратор или принтер квитанций; продажа без бумаги недоступна.";
            if(!FrontOrderPrintDisabled(Setting("FRONT_CONFIG_PATH")))
                return "Не подтверждено EnableOrderPrint=false в действующем config.xml iikoFront.";
            if(PaymentAllowlist().Count==0) return "Не выбраны проверенные нефискальные способы оплаты для этой кассы.";
            var group=os.GetHostTerminalsGroup();
            if(group.MainTerminal==null || (group.MainTerminal.Id!=terminal && !os.IsConnectedToMainTerminal()))
                return "Нет связи с главной кассой iiko.";
            return null;
        }
        internal static string PaymentProblem(IOperationService os,IPaymentType type,HashSet<Guid> silent,HashSet<Guid> allowlist)
        {
            if(type.PrintCheque || type.FiscalizeAsDiscount) return "Фискальный способ оплаты недоступен для регистрации без фискализации.";
            if(!type.IsEnabled || type.IsHidden || type.ProcessAsDiscount) return "Способ оплаты выключен, скрыт или учитывается как скидка.";
            if(!silent.Contains(type.Id)) return "Способ оплаты требует действий на кассе iiko.";
            if(!allowlist.Contains(type.Id)) return "Способ оплаты не проверен для работы без бумаги.";
            // External processors can print their own slips or charge a bank
            // terminal. Do not treat an existing prepaid processor as tender.
            if(!string.IsNullOrEmpty(os.GetPaymentSystemKey(type)) || (type.Kind!=PaymentTypeKind.Cash
                && type.Kind!=PaymentTypeKind.Card && type.Kind!=PaymentTypeKind.Unknown))
                return "Обработчик оплаты или дополнительные реквизиты пока не поддерживаются без бумаги.";
            return null;
        }
        internal static VirtualPosSnapshot Capture(IOperationService os)
        {
            var terminal=os.GetHostTerminal();var point=PointOfSale(os);var table=Table(os);
            ICafeSession shift=point?.CashRegister==null ? null : os.TryGetCafeSessionByCashRegister(point.CashRegister);
            var problem=NoPaperProblem(os,point,table);
            if(shift==null) problem=problem ?? "В iiko не открыта кассовая смена.";
            var snapshot=new VirtualPosSnapshot {
                TerminalId=terminal.Id.ToString(),TerminalName=DisplayName(terminal.Name,"iiko",100),CapturedAt=DateTime.UtcNow.ToString("o"),
                CashShift=new VirtualPosShift {Id=shift?.Id.ToString(),IsOpen=shift!=null,Number=shift?.Number.ToString(CultureInfo.InvariantCulture)},
                Profile=new VirtualPosProfile {NonFiscalNoPaperVerified=problem==null,Reason=problem}
            };
            var silent=new HashSet<Guid>(os.GetPaymentTypesToPayOutOnUser().Select(p=>p.Id));
            var allowlist=PaymentAllowlist();
            var actualPayments=os.GetPaymentTypes();
            foreach(var type in actualPayments.OrderBy(p=>p.Id))
            {
                var paymentProblem=PaymentProblem(os,type,silent,allowlist);
                snapshot.PaymentTypes.Add(new VirtualPosPayment {Id=type.Id.ToString(),Name=DisplayName(type.Name,type.Id.ToString(),250),Kind=type.Kind.ToString(),
                    IsFiscal=type.PrintCheque || type.FiscalizeAsDiscount,Selectable=paymentProblem==null,Reason=paymentProblem});
            }
            if(snapshot.PaymentTypes.Count>64)
            {
                snapshot.PaymentTypes.Clear();
                snapshot.Profile.NonFiscalNoPaperVerified=false;
                snapshot.Profile.Reason="На кассе больше 64 способов оплаты; каталог требует настройки перед продажами Bulka.";
            }
            else if(!snapshot.PaymentTypes.Any(p=>p.Selectable))
            {
                snapshot.Profile.NonFiscalNoPaperVerified=false;
                snapshot.Profile.Reason=snapshot.Profile.Reason ?? "На кассе нет разрешённой нефискальной оплаты без бумаги.";
            }
            if(table!=null)
            {
                var now=DateTime.Now;
                var paymentTypes=actualPayments.ToDictionary(p=>p.Id);
                foreach(var product in os.GetActiveProducts().OrderBy(p=>p.Id))
                {
                    // Unsupported sized products still need a real size for
                    // read-only menu/price queries in the Front SDK.
                    var size=product.Scale==null ? null : os.GetProductScaleSizes(product.Scale).FirstOrDefault();
                    if(product.Scale!=null && size==null) continue;
                    if(!os.GetIncludedInMenu(product,size,table.RestaurantSection,null,now)) continue;
                    var price=os.GetPrice(product,size,null,now);
                    var reason=product.Scale!=null || product.Template!=null ? "Размеры и составные блюда пока доступны только в iiko."
                        : product.CanSetOpenPrice || product.Type==ProductType.Rate || product.Type==ProductType.Petrol
                            || product.Type==ProductType.Modifier || product.Type==ProductType.ForPurchase || product.ImmediateCookingStart
                            ? "Товар требует отдельного оформления или запуска приготовления в iiko."
                        : os.GetSimpleModifiers(product,null).Count>0 || os.GetGroupModifiers(product,null).Count>0
                            ? "Модификаторы пока доступны только в iiko."
                        : price<=0 || price>1000000m || Math.Round(price,2,MidpointRounding.AwayFromZero)!=price
                            ? "Цена товара не поддерживается в кассе Bulka."
                        : os.IsStopListProductSellingRestricted(product,null) ? "Товар находится в стоп-листе." : null;
                    var paymentIds=snapshot.PaymentTypes.Where(p=>p.Selectable && os.CanProductBePaidWithPaymentType(product,paymentTypes[Guid.Parse(p.Id)]))
                        .Select(p=>p.Id).ToList();
                    if(paymentIds.Count==0) reason=reason ?? "Нет совместимого нефискального способа оплаты без бумаги.";
                    snapshot.Products.Add(new VirtualPosProduct {Id=product.Id.ToString(),Name=DisplayName(product.Name,product.Id.ToString(),250),
                        Price=Math.Round(Math.Max(0m,Math.Min(1000000m,price)),2,MidpointRounding.AwayFromZero),
                        QuantityStep=product.UseBalanceForSell ? 0.001m : 1m,
                        Unit=DisplayName(product.MeasuringUnit?.Name,product.UseBalanceForSell ? "кг" : "шт",50),
                        Available=reason==null,UnavailableReason=reason,PaymentTypeIds=paymentIds});
                    if(snapshot.Products.Count>2000)
                    {
                        snapshot.Products.Clear();snapshot.Profile.NonFiscalNoPaperVerified=false;
                        snapshot.Profile.Reason="В меню кассы больше 2000 товаров; каталог требует настройки перед продажами Bulka.";
                        break;
                    }
                }
            }
            // Exclude capture time from revision; catalog and shift changes
            // invalidate queued quotes, periodic identical snapshots do not.
            var captured=snapshot.CapturedAt;snapshot.CapturedAt=null;
            snapshot.Revision=Hash(Json(snapshot));snapshot.CapturedAt=captured;
            return snapshot;
        }
        internal static void ValidateCommand(VirtualPosCommand command,VirtualPosSnapshot snapshot)
        {
            if(command==null || !Guid.TryParse(command.SaleId,out var sale) || sale==Guid.Empty
                || !Guid.TryParse(command.LeaseToken,out var lease) || lease==Guid.Empty
                || command.TerminalId!=snapshot.TerminalId || command.CashShiftId!=snapshot.CashShift.Id
                || !snapshot.CashShift.IsOpen || command.SnapshotRevision!=snapshot.Revision)
                throw new InvalidOperationException("Касса, смена или каталог изменились. Обновите продажу.");
            if(!snapshot.Profile.NonFiscalNoPaperVerified) throw new InvalidOperationException(snapshot.Profile.Reason);
            var payment=snapshot.PaymentTypes.SingleOrDefault(p=>p.Id==command.PaymentTypeId);
            if(payment==null || !payment.Selectable || payment.IsFiscal) throw new InvalidOperationException("Выбранный способ оплаты недоступен без фискализации и бумаги.");
            if(command.Items==null || command.Items.Count==0 || command.Items.Count>100
                || command.Items.Select(i=>i.ProductId).Distinct().Count()!=command.Items.Count)
                throw new InvalidOperationException("Недопустимый состав продажи.");
            decimal total=0;
            foreach(var item in command.Items)
            {
                var product=snapshot.Products.SingleOrDefault(p=>p.Id==item.ProductId);
                if(product==null || !product.Available || !product.PaymentTypeIds.Contains(command.PaymentTypeId)
                    || !ValidQuantity(item.Quantity,product.QuantityStep) || item.Price!=product.Price)
                    throw new InvalidOperationException("Товар, количество или цена изменились. Обновите продажу.");
                total+=item.LineTotal;
                if(item.LineTotal!=Math.Round(item.Price*item.Quantity,2,MidpointRounding.AwayFromZero))
                    throw new InvalidOperationException("Сумма позиции не совпадает с ценой iiko.");
            }
            if(command.Total<=0 || command.Total!=total) throw new InvalidOperationException("Итог продажи не совпадает с ценами iiko.");
        }
    }
}
