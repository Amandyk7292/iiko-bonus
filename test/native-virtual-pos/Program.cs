using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Remoting.Proxies;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.DataTransferObjects;
using Resto.Front.Api.Data.Device;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Organization.Sections;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Editors;
using Resto.Front.Api.Editors.Stubs;
using Resto.Front.Api.IikoBonusPlugin;

internal sealed class Proxy:RealProxy
{
    private readonly Func<IMethodCallMessage,object> call;
    private Proxy(Type type,Func<IMethodCallMessage,object> method):base(type){call=method;}
    internal static T Make<T>(Func<IMethodCallMessage,object> method) where T:class => (T)new Proxy(typeof(T),method).GetTransparentProxy();
    internal static object Stub(Type type) => new Proxy(type,message=>null).GetTransparentProxy();
    internal static T Props<T>(Dictionary<string,object> values) where T:class => Make<T>(message=>{
        if(values.TryGetValue(message.MethodName.Replace("get_",""),out var value)) return value;
        var type=((MethodInfo)message.MethodBase).ReturnType;
        if(Nullable.GetUnderlyingType(type)!=null) return null;
        if(type.IsGenericType && type.GetGenericArguments().Length==1) return Array.CreateInstance(type.GetGenericArguments()[0],0);
        return type.IsValueType ? Activator.CreateInstance(type) : null;
    });
    public override IMessage Invoke(IMessage message)
    {
        var request=(IMethodCallMessage)message;
        try {return new ReturnMessage(call(request),null,0,request.LogicalCallContext,request);}
        catch(Exception error) {return new ReturnMessage(error,request);}
    }
}
internal sealed class Services:IServiceProvider
{
    internal IOperationService Operations;
    public object GetService(Type type) => type==typeof(IOperationService) ? Operations : null;
}
internal sealed class Scenario
{
    internal readonly string DirectoryPath=Path.Combine(Path.GetTempPath(),"bulka-virtual-pos-"+Guid.NewGuid());
    internal string LedgerPath => Path.Combine(DirectoryPath,"ledger.json");
    internal readonly Guid TerminalId=Guid.NewGuid(),ShiftId=Guid.NewGuid(),ProductId=Guid.NewGuid(),PaymentId=Guid.NewGuid(),OrderId=Guid.NewGuid();
    internal readonly Dictionary<string,object> PaymentProps,ProductProps,OrderProps=new Dictionary<string,object>(),ItemProps=new Dictionary<string,object>();
    internal readonly List<string> Actions=new List<string>();
    internal readonly IProduct Product;
    internal readonly IPaymentType Payment;
    internal readonly IPointOfSale Point;
    internal readonly ITable Table;
    internal IOperationService Operations;
    internal VirtualPosCommand Command;
    internal VirtualPosSnapshot Snapshot;
    internal IOrder Order;
    internal PastOrder ClosedOrder;
    internal int Creates,PaymentAdds,PayCalls;
    internal bool CreateSubmitLost,PaymentResponseLost,CompletedAckLost,CreationGuardLost,GuardDenied,PayGuardDenied,ShiftChanged,ReceiptPrinter,ShiftAtCreated;
    internal string ServerPhase="claimed";
    internal ProductsSellingPossibility StockResult=ProductsSellingPossibility.Allowed;
    internal decimal ProductPrice=500m;
    internal List<IProduct> ActiveProducts;
    internal List<IPaymentType> PaymentTypes;

    internal Scenario()
    {
        Directory.CreateDirectory(DirectoryPath);
        var config=Path.Combine(DirectoryPath,"config.xml");File.WriteAllText(config,"<config><EnableOrderPrint>false</EnableOrderPrint></config>");
        var registerId=Guid.NewGuid();
        foreach(var pair in new Dictionary<string,string> {
            {"NO_PAPER_VERIFIED","true"},{"TERMINAL_ID",TerminalId.ToString()},{"CASH_REGISTER_ID",registerId.ToString()},
            {"PAYMENT_TYPE_IDS",PaymentId.ToString()},{"FRONT_CONFIG_PATH",config}
        }) Environment.SetEnvironmentVariable("IIKO_VIRTUAL_POS_"+pair.Key,pair.Value);
        Environment.SetEnvironmentVariable("IIKO_BRANCH_ID",Guid.NewGuid().ToString());
        var section=Proxy.Props<IRestaurantSection>(new Dictionary<string,object>{{"Id",Guid.NewGuid()}});
        Table=Proxy.Props<ITable>(new Dictionary<string,object>{{"Id",Guid.NewGuid()},{"IsActive",true},{"RestaurantSection",section}});
        Environment.SetEnvironmentVariable("IIKO_VIRTUAL_POS_TABLE_ID",Table.Id.ToString());
        var terminal=Proxy.Props<ITerminal>(new Dictionary<string,object>{{"Id",TerminalId},{"Name","Test native register"}});
        var group=Proxy.Props<ITerminalsGroup>(new Dictionary<string,object>{{"Id",Guid.NewGuid()},{"MainTerminal",terminal}});
        var register=Proxy.Props<ICashRegisterInfo>(new Dictionary<string,object>{{"Id",registerId},{"IsVirtual",true}});
        var shift=Proxy.Props<ICafeSession>(new Dictionary<string,object>{{"Id",ShiftId},{"Number",42},{"CashRegister",register}});
        var otherShift=Proxy.Props<ICafeSession>(new Dictionary<string,object>{{"Id",Guid.NewGuid()},{"Number",43},{"CashRegister",register}});
        Point=Proxy.Props<IPointOfSale>(new Dictionary<string,object>{{"Id",Guid.NewGuid()},{"CashRegister",register},{"IsDefault",true}});
        ProductProps=new Dictionary<string,object>{{"Id",ProductId},{"Name","Real iiko product"},{"IsActive",true},{"Price",500m},{"Type",ProductType.Goods}};
        Product=Proxy.Props<IProduct>(ProductProps);ActiveProducts=new List<IProduct>{Product};
        PaymentProps=new Dictionary<string,object>{{"Id",PaymentId},{"Name","Actual nonfiscal tender"},{"Kind",PaymentTypeKind.Unknown},{"IsEnabled",true}};
        Payment=Proxy.Props<IPaymentType>(PaymentProps);
        PaymentTypes=new List<IPaymentType>{Payment};
        Operations=Proxy.Make<IOperationService>(message=>{
            switch(message.MethodName)
            {
                case "GetHostTerminal": return terminal;
                case "GetHostTerminalsGroup": return group;
                case "GetHostTerminalRestaurantSections": return new[]{section};
                case "GetTables": return new[]{Table};
                case "GetHostTerminalPointsOfSale": return new[]{Point};
                case "TryGetCafeSessionByCashRegister": return ShiftChanged ? otherShift : shift;
                case "TryGetReceiptChequePrinter": return ReceiptPrinter ? Proxy.Props<Resto.Front.Api.Data.Print.IPrinterQueueRef>(new Dictionary<string,object>()) : null;
                case "GetPaymentTypes": case "GetPaymentTypesToPayOutOnUser": return PaymentTypes;
                case "GetPaymentSystemKey": return "";
                case "GetActiveProducts": return ActiveProducts;
                case "GetIncludedInMenu": case "CanProductBePaidWithPaymentType": return true;
                case "GetPrice": return ProductPrice;
                case "GetSimpleModifiers": return new ISimpleModifier[0];
                case "GetGroupModifiers": return new IGroupModifier[0];
                case "IsStopListProductSellingRestricted": return false;
                case "CheckStopListProductsSellingRestrictions": return new ProductsSellingRestrictions(StockResult,new Dictionary<ProductAndSize,decimal>());
                case "GetOrders": return Order==null ? new IOrder[0] : new[]{Order};
                case "TryGetOrderById": case "GetOrderById": return Order;
                case "GetPastOrder": return ClosedOrder;
                case "TryGetOrderExternalDataByKey": return Command.SaleId;
                case "GetProductById": return Product;
                case "GetPaymentTypeById": return Payment;
                case "GetDefaultCredentials": return Proxy.Props<ICredentials>(new Dictionary<string,object>());
                case "NeedToSplitOrderBeforePayment": return new CheckSplitResultDto {CheckSplitRequiredResult=CheckSplitRequiredResult.Disabled,PointOfSale=Point};
                case "CreateEditSession": return Edit();
                case "SubmitChanges":
                    if(Order==null)
                    {
                        ItemProps["Id"]=Guid.NewGuid();ItemProps["Product"]=Product;ItemProps["Amount"]=2m;ItemProps["ResultSum"]=1000m;
                        var item=Proxy.Props<IOrderProductItem>(ItemProps);
                        OrderProps["Id"]=OrderId;OrderProps["Number"]=55;OrderProps["Status"]=OrderStatus.New;
                        OrderProps["ResultSum"]=Command.Total;OrderProps["ExternalNumber"]=VirtualPosSync.Prefix+Command.SaleId;
                        OrderProps["Items"]=new IOrderRootItem[]{item};OrderProps["Payments"]=new IPaymentItem[0];
                        Order=Proxy.Props<IOrder>(OrderProps);
                        if(CreateSubmitLost) throw new IOException("lost create response");
                    }
                    return Proxy.Make<ISubmittedEntities>(m=>m.Args[0] is INewOrderStub ? (object)Order : NewPayment());
                case "PayOrder":
                    PayCalls++;
                    if(ServerPhase!="payment_started" || !File.ReadAllText(LedgerPath).Contains("\"PaymentStarted\":true"))
                        throw new Exception("Payment ran before durable native/server guard");
                    if(message.Args[3]!=null) throw new Exception("Russia-only no-paper flag used");
                    OrderProps["Status"]=OrderStatus.Closed;
                    ClosedOrder=new PastOrder {OrderId=OrderId,Number=55,CashRegister=Point.CashRegister,CafeSessionId=ShiftId,
                        ExternalNumber=VirtualPosSync.Prefix+Command.SaleId,FiscalChequeNumbers=new List<int>(),
                        PublicExternalData=new Dictionary<string,string>{{VirtualPosSync.OrderDataKey,Command.SaleId}},
                        Payments=new[]{new PastOrderPayment {PaymentType=Payment,Sum=Command.Total}},
                        Items=new List<PastOrderItem>{new PastOrderItem {Product=Product,Price=500m,Amount=2m,SumWithDiscounts=1000m}}};
                    if(PaymentResponseLost) throw new IOException("lost payment response");
                    return null;
                default: throw new Exception("Unexpected SDK method: "+message.MethodName);
            }
        });
        Snapshot=VirtualPosCatalog.Capture(Operations);
        Command=new VirtualPosCommand {SaleId=Guid.NewGuid().ToString(),LeaseToken=Guid.NewGuid().ToString(),TerminalId=TerminalId.ToString(),
            CashShiftId=ShiftId.ToString(),PaymentTypeId=PaymentId.ToString(),SnapshotRevision=Snapshot.Revision,Phase="claimed",Total=1000m,
            Items=new List<VirtualPosItem>{new VirtualPosItem {ProductId=ProductId.ToString(),Quantity=2m,Price=500m,LineTotal=1000m,Name="Real iiko product"}}};
    }
    private IPaymentItem NewPayment() => Proxy.Props<IPaymentItem>(new Dictionary<string,object>{{"Id",Guid.Parse(Command.SaleId)},{"Type",Payment},{"Sum",1000m}});
    private IEditSession Edit() => Proxy.Make<IEditSession>(message=>{
        switch(message.MethodName)
        {
            case "CreateOrder":
                Creates++;
                if(ServerPhase!="creating" || !File.ReadAllText(LedgerPath).Contains("\"CreationStarted\":true"))
                    throw new Exception("Create ran before durable native/server guard");
                break;
            case "AddOrderProductItem": if(message.Args[6]!=null) throw new Exception("Native price overridden");break;
            case "AddPaymentItem":
                PaymentAdds++;
                if(ServerPhase!="payment_started") throw new Exception("Payment added without guard");
                OrderProps["Payments"]=new[]{NewPayment()};break;
        }
        var type=((MethodInfo)message.MethodBase).ReturnType;
        return type==typeof(void) ? null : Proxy.Stub(type);
    });
    internal VirtualPosResponse Transport(HttpMethod method,string endpoint,object payload)
    {
        if(endpoint!="action") throw new Exception("Unexpected HTTP endpoint");
        var action=(VirtualPosAction)payload;Actions.Add(action.Action);
        var guarded=action.Action=="creating" || action.Action=="payment_started";
        if(guarded && (GuardDenied || (PayGuardDenied && action.Action=="payment_started")))
            return new VirtualPosResponse {Success=true,GuardAccepted=false,Sale=new VirtualPosSaleState {Status=action.Action}};
        if(guarded && ServerPhase==action.Action) return new VirtualPosResponse {Success=true,GuardAccepted=false,Sale=new VirtualPosSaleState {Status=ServerPhase}};
        ServerPhase=action.Action;
        if(ShiftAtCreated && action.Action=="created") ShiftChanged=true;
        if(CreationGuardLost && action.Action=="creating") throw new IOException("lost create guard ACK");
        if(CompletedAckLost && action.Action=="completed") throw new IOException("lost completed ACK");
        return new VirtualPosResponse {Success=true,GuardAccepted=guarded,Sale=new VirtualPosSaleState {Status=action.Action}};
    }
    internal VirtualPosSync Worker() => new VirtualPosSync(false,LedgerPath,Transport);
    internal void Run(VirtualPosSync worker) => worker.Process(Command,Operations,Snapshot);
}
internal static class Program
{
    private static int assertions;
    private static void Check(bool value,string label){if(!value) throw new Exception(label);assertions++;Console.WriteLine("PASS: "+label);}
    private static void Fails(Action action,string label){try {action();}catch {assertions++;Console.WriteLine("PASS: "+label);return;}throw new Exception(label);}
    private static void Main()
    {
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR",Path.Combine(Path.GetTempPath(),"bulka-virtual-pos-context-"+Guid.NewGuid()));
        var services=new Services {Operations=Proxy.Make<IOperationService>(m=>throw new Exception("Unexpected global SDK call"))};
        PluginContext.Initialize(services,()=>{},Proxy.Make<ILog>(m=>null));
        Policy();CatalogLimits();Stock();Success();PaymentCallback();GuardFailure();UncertainCreate();UncertainPayment();CorruptLedger();ChangedQuote();ChangedShift();ArchivedProof();
        Console.WriteLine("PASS: "+assertions+" virtual POS checks; all SDK calls mocked, no HTTP, payment, printer or production access.");
        PluginContext.Uninitialize();
    }
    private static void PaymentCallback()
    {
        var s=new Scenario();using(var worker=s.Worker())s.Run(worker);
        using(var restart=s.Worker())
        {
            s.ItemProps["Amount"]=3m;
            Fails(()=>restart.BeforePayment(s.Order,s.Operations),"native before-payment callback blocks equal-total quantity tampering");
            s.ItemProps["Amount"]=2m;s.ItemProps["ResultSum"]=900m;
            Fails(()=>restart.BeforePayment(s.Order,s.Operations),"native before-payment callback blocks changed per-item sum");
            s.ItemProps["ResultSum"]=1000m;s.PaymentProps["PrintCheque"]=true;
            Fails(()=>restart.BeforePayment(s.Order,s.Operations),"native before-payment callback blocks fiscal tender reconfiguration");
            s.PaymentProps["PrintCheque"]=false;s.ReceiptPrinter=true;
            Fails(()=>restart.BeforePayment(s.Order,s.Operations),"native before-payment callback blocks newly attached receipt printer");
        }
    }
    private static void CatalogLimits()
    {
        var s=new Scenario();s.ProductProps["Name"]=new string('x',300);
        Check(VirtualPosCatalog.Capture(s.Operations).Products[0].Name.Length==250,"catalog display metadata stays inside transport bounds");
        s.ProductPrice=1.111m;
        var price=VirtualPosCatalog.Capture(s.Operations).Products[0];
        Check(!price.Available && price.Price==1.11m,"unsupported price precision disables product without breaking catalog transport");
        s.ProductPrice=-1m;
        Check(!VirtualPosCatalog.Capture(s.Operations).Products[0].Available,"negative native price never becomes a sellable product");
        s.ProductPrice=500m;s.ProductProps["ImmediateCookingStart"]=true;
        Check(!VirtualPosCatalog.Capture(s.Operations).Products[0].Available,"immediate cooking cannot trigger automatic kitchen output from web sale");
        var large=new Scenario();
        large.ActiveProducts=Enumerable.Range(0,2001).Select(i=>Proxy.Props<IProduct>(new Dictionary<string,object>{
            {"Id",Guid.NewGuid()},{"Name","Product "+i},{"IsActive",true},{"Type",ProductType.Goods}})).ToList();
        var catalog=VirtualPosCatalog.Capture(large.Operations);
        Check(!catalog.Profile.NonFiscalNoPaperVerified && catalog.Products.Count==0,"oversized catalog publishes unavailable profile instead of partial sellable menu");
        var payments=new Scenario();
        payments.PaymentTypes=Enumerable.Range(0,65).Select(i=>Proxy.Props<IPaymentType>(new Dictionary<string,object>{
            {"Id",Guid.NewGuid()},{"Name","Payment "+i},{"Kind",PaymentTypeKind.Unknown},{"IsEnabled",true}})).ToList();
        var many=VirtualPosCatalog.Capture(payments.Operations);
        Check(!many.Profile.NonFiscalNoPaperVerified && many.PaymentTypes.Count==0,"oversized payment catalog fails closed without rejecting heartbeat transport");
    }
    private static void Stock()
    {
        var s=new Scenario {StockResult=ProductsSellingPossibility.AllowedForced};
        using(var worker=s.Worker())Fails(()=>s.Run(worker),"forced negative stock is never silently authorized");
        Check(s.Creates==0 && s.PaymentAdds==0 && s.PayCalls==0 && s.ServerPhase=="rejected","stock preflight stops every mutation before native create guard");
    }
    private static void Policy()
    {
        Check(VirtualPosCatalog.ValidQuantity(2m,1m) && !VirtualPosCatalog.ValidQuantity(1.5m,1m),"piece quantity rejects fractional sale");
        Check(VirtualPosCatalog.ValidQuantity(0.001m,0.001m) && !VirtualPosCatalog.ValidQuantity(0.0001m,0.001m),"weight quantity requires exact thousandth step");
        Check(!VirtualPosCatalog.ValidQuantity(0m,1m) && !VirtualPosCatalog.ValidQuantity(10000m,1m),"quantity bounds enforced");
        var s=new Scenario();
        Check(s.Snapshot.Profile.NonFiscalNoPaperVerified && s.Snapshot.Products[0].Price==500m,"actual SDK catalog and verified virtual register publish authority");
        s.ReceiptPrinter=true;
        Check(!VirtualPosCatalog.Capture(s.Operations).Profile.NonFiscalNoPaperVerified,"attached receipt printer disables no-paper capability");
        s.ReceiptPrinter=false;s.PaymentProps["PrintCheque"]=true;
        Check(!VirtualPosCatalog.Capture(s.Operations).PaymentTypes[0].Selectable,"actual fiscal payment cannot be selected");
        Check(!VirtualPosCatalog.Capture(s.Operations).Profile.NonFiscalNoPaperVerified,"absence of supported nonfiscal tender disables capability with visible reason");
        s.PaymentProps["PrintCheque"]=false;
        Environment.SetEnvironmentVariable("IIKO_VIRTUAL_POS_NO_PAPER_VERIFIED","false");
        Check(!VirtualPosCatalog.Capture(s.Operations).Profile.NonFiscalNoPaperVerified,"default unverified profile fails closed");
        var config=Path.Combine(s.DirectoryPath,"config.xml");
        File.WriteAllText(config,"<config><EnableOrderPrint>true</EnableOrderPrint></config>");
        Check(!VirtualPosCatalog.FrontOrderPrintDisabled(config),"read-only live configuration with printing enabled rejected");
        File.WriteAllText(config,"<config/>");
        Check(!VirtualPosCatalog.FrontOrderPrintDisabled(config),"missing print configuration not assumed safe");
        File.WriteAllText(config,"<config><EnableOrderPrint>false</EnableOrderPrint><EnableOrderPrint>false</EnableOrderPrint></config>");
        Check(!VirtualPosCatalog.FrontOrderPrintDisabled(config),"ambiguous duplicate print configuration rejected");
    }
    private static void Success()
    {
        var s=new Scenario();using(var worker=s.Worker())s.Run(worker);
        Check(s.Creates==1 && s.PaymentAdds==1 && s.PayCalls==1 && s.ServerPhase=="completed","one real native tender closes one native order under both durable guards");
        s.Command.Phase="payment_started";using(var restart=s.Worker())s.Run(restart);
        Check(s.Creates==1 && s.PayCalls==1,"restart and duplicate command acknowledge original closed order without repayment");
        var digest=VirtualPosSync.Digest(s.Command);s.Command.LeaseToken=Guid.NewGuid().ToString();
        Check(VirtualPosSync.Digest(s.Command)==digest,"transport lease and phase do not change immutable sale digest");
        s.Command.Items[0].Quantity=3m;
        using(var restart=s.Worker())Fails(()=>s.Run(restart),"same sale identity with mutated payload cannot resume native work");
        Check(s.Creates==1 && s.PayCalls==1,"immutable journal prevents changed replay from creating or paying again");
    }
    private static void GuardFailure()
    {
        var s=new Scenario {GuardDenied=true};using(var worker=s.Worker())Fails(()=>s.Run(worker),"denied creation guard requires reconciliation");
        Check(s.Creates==0 && s.PayCalls==0 && s.ServerPhase=="needs_reconciliation","another worker's guard blocks every native mutation");
        var lost=new Scenario {CreationGuardLost=true};using(var worker=lost.Worker())Fails(()=>lost.Run(worker),"lost guard acknowledgment never authorizes create");
        Check(lost.Creates==0 && lost.PayCalls==0 && lost.ServerPhase=="needs_reconciliation","lost committed guard ACK cannot requeue financial work");
        var payment=new Scenario {PayGuardDenied=true};using(var worker=payment.Worker())Fails(()=>payment.Run(worker),"denied payment guard requires reconciliation");
        Check(payment.Creates==1 && payment.PaymentAdds==0 && payment.PayCalls==0,"denied payment guard never adds native tender");
    }
    private static void UncertainCreate()
    {
        var s=new Scenario {CreateSubmitLost=true};using(var worker=s.Worker())Fails(()=>s.Run(worker),"uncertain committed CreateOrder response recorded");
        s.Command.Phase="needs_reconciliation";using(var restart=s.Worker())s.Run(restart);
        Check(s.Creates==1 && s.PayCalls==0 && s.ServerPhase=="needs_reconciliation","native marker recovers original order but never pays uncertain create automatically");
        s.Order=null;using(var restart=s.Worker())s.Run(restart);
        Check(s.Creates==1,"missing original order after uncertain create never creates duplicate");
    }
    private static void UncertainPayment()
    {
        var s=new Scenario {PaymentResponseLost=true};using(var worker=s.Worker())Fails(()=>s.Run(worker),"uncertain committed PayOrder response recorded");
        s.Command.Phase="needs_reconciliation";using(var restart=s.Worker())s.Run(restart);
        Check(s.PayCalls==1 && s.ServerPhase=="completed","restart confirms already closed order after lost payment response without second tender");
        var ack=new Scenario {CompletedAckLost=true};using(var worker=ack.Worker())Fails(()=>ack.Run(worker),"lost completion ACK preserves native proof");
        ack.CompletedAckLost=false;ack.Command.Phase="needs_reconciliation";
        using(var restart=ack.Worker())ack.Run(restart);
        Check(ack.PayCalls==1 && ack.ServerPhase=="completed","completion ACK can retry without sale retry");
    }
    private static void CorruptLedger()
    {
        var s=new Scenario();File.WriteAllText(s.LedgerPath,"{corrupt");
        using(var worker=s.Worker())Fails(()=>s.Run(worker),"corrupt journal blocks sale processing");
        Check(s.Creates==0 && s.PayCalls==0,"corrupt journal never falls back to empty or backup ledger");
    }
    private static void ChangedQuote()
    {
        var s=new Scenario();s.Command.Items[0].Price=1m;
        using(var worker=s.Worker())Fails(()=>s.Run(worker),"changed quote rejected before creation");
        Check(s.Creates==0 && s.ServerPhase=="rejected","definitive validation error never creates order");
        var duplicate=new Scenario();duplicate.Command.Items.Add(duplicate.Command.Items[0]);
        using(var worker=duplicate.Worker())Fails(()=>duplicate.Run(worker),"duplicate product rows rejected");
    }
    private static void ChangedShift()
    {
        var s=new Scenario {ShiftChanged=true};
        using(var worker=s.Worker())Fails(()=>s.Run(worker),"live cash shift revalidated before create");
        Check(s.Creates==0 && s.PaymentAdds==0 && s.PayCalls==0 && s.ServerPhase=="rejected","shift change before create never commits old shift sale");
        var created=new Scenario {ShiftAtCreated=true};
        using(var worker=created.Worker())Fails(()=>created.Run(worker),"live shift revalidated after created ACK");
        Check(created.Creates==1 && created.PaymentAdds==0 && created.PayCalls==0 && created.ServerPhase=="needs_reconciliation","shift change cannot move created sale into another cash shift");
    }
    private static void ArchivedProof()
    {
        var s=new Scenario();using(var worker=s.Worker())s.Run(worker);
        s.Order=null;s.Command.Phase="needs_reconciliation";
        using(var restart=s.Worker())s.Run(restart);
        Check(s.PayCalls==1 && s.ServerPhase=="completed","archive proof recovers original sale after order leaves active shift without repayment");
        var wrong=new Scenario();using(var worker=wrong.Worker())wrong.Run(worker);
        wrong.ClosedOrder.CafeSessionId=Guid.NewGuid();wrong.Command.Phase="needs_reconciliation";
        using(var restart=wrong.Worker())Fails(()=>wrong.Run(restart),"sale closed in another cash shift cannot acknowledge success");
        Check(wrong.PayCalls==1 && wrong.ServerPhase=="needs_reconciliation","wrong-shift archive proof requires reconciliation without repayment");
        var fiscal=new Scenario();using(var worker=fiscal.Worker())fiscal.Run(worker);
        fiscal.ClosedOrder.FiscalChequeNumbers.Add(123);fiscal.Command.Phase="needs_reconciliation";
        using(var restart=fiscal.Worker())Fails(()=>fiscal.Run(restart),"fiscalized archive cannot acknowledge nonfiscal sale");
    }
}
