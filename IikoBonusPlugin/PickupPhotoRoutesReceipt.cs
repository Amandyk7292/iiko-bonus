using System;
using System.Linq;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static partial class PickupPhotoRoutes
    {
        private static bool LifecycleActive=>subscription?.Current==true;
        internal static int ReceiptGeneration {get {lock(gate) return LifecycleActive && healthy ? generation : -1;}}
        private static bool ValidSource(PickupPhotoRouteBinding binding)
        {
            if(binding.Kind=="receipt") return binding.QueueId==null && binding.SectionId=="none"
                && binding.ReceiptPointCount>0 && binding.ReceiptPointCount<=PickupPhotoReceiptRoute.MaximumPoints
                && binding.ReceiptProof?.Length==64 && binding.ReceiptProof.All(c=>c>='0' && c<='9' || c>='a' && c<='f');
            return new[]{"bill","document","receipt_queue"}.Contains(binding.Kind) && Guid.TryParse(binding.QueueId,out var queue) && queue!=Guid.Empty
                && (binding.SectionId=="none" || Guid.TryParse(binding.SectionId,out _))
                && (binding.Kind!="receipt_queue" || binding.SectionId=="none")
                && binding.ReceiptProof==null && binding.ReceiptPointCount==0;
        }
        internal static IPrinterQueueRef ConfiguredReceiptQueue(IOperationService os)
        {
            try
            {
                // This SDK route is the configured default cash register's
                // receipt printer. Its queue ID is never treated as a device ID.
                var queue=os.TryGetReceiptChequePrinter(true);
                if(queue==null) return null;
                if(queue.Id==Guid.Empty) throw new InvalidOperationException();
                BindQueue(os,queue,null,"receipt_queue");return queue;
            }
            catch(Exception error)
            {
                lock(gate) startupDiagnostic="receipt_queue_failed type="+error.GetType().Name;
                throw;
            }
        }
        internal static bool HasReceiptQueueBinding(IOperationService os,string orderId)
            => BindingKind(os,orderId)=="receipt_queue";
        internal static string BindingKind(IOperationService os,string orderId)
        {
            var terminal=os.GetHostTerminal().Id.ToString();var branch=LoyaltyFlow.BranchId;
            lock(gate) return LifecycleActive && healthy && bindings.TryGetValue(BindingKey(branch,terminal,orderId),out var binding)
                ? binding.Kind : null;
        }
        internal static bool IsReceiptQueue(IPrinterQueueRef queue)
        {
            lock(gate) return queue!=null && queues.TryGetValue(queue,out var route) && route.Kind=="receipt_queue";
        }
        internal static bool CanUseReceiptRoute(out string reason)
        {
            EnsureRegistration();
            lock(gate) {reason=!LifecycleActive ? "stopped" : !healthy ? "journal_unhealthy" : "ready";return LifecycleActive && healthy;}
        }
        internal static bool HasReceiptBinding(IOperationService os,string orderId)
            => TryReceiptBinding(os,orderId,out _);
        internal static bool TryReceiptBinding(IOperationService os,string orderId,out PickupPhotoReceiptRoute route)
        {
            route=null;
            var terminal=os.GetHostTerminal().Id.ToString();var branch=LoyaltyFlow.BranchId;
            lock(gate)
            {
                if(!LifecycleActive || !healthy || !bindings.TryGetValue(BindingKey(branch,terminal,orderId),out var binding)
                    || binding.Kind!="receipt") return false;
                route=new PickupPhotoReceiptRoute {Branch=branch,Terminal=terminal,Device=Guid.Parse(binding.DeviceId),
                    Proof=binding.ReceiptProof,PointCount=binding.ReceiptPointCount,Generation=generation};return true;
            }
        }
        internal static bool ReserveReceiptOrder(IOperationService os,PickupPhotoReceiptRoute route,string orderId,Guid frontOrder,
            string photoId,long number,out string reason)
        {
            reason="device_unmapped";
            var terminal=os.GetHostTerminal().Id.ToString();var branch=LoyaltyFlow.BranchId;
            lock(gate)
            {
                if(!LifecycleActive || !healthy || route==null || route.Generation!=generation || route.Terminal!=terminal || route.Branch!=branch
                    || !Guid.TryParse(orderId,out _) || !Guid.TryParse(photoId,out _) || frontOrder==Guid.Empty || number<=0) return false;
                var key=BindingKey(branch,terminal,orderId);
                if(bindings.TryGetValue(key,out var existing))
                {
                    if(existing.Kind!="receipt" || existing.Phase!="reserved" || existing.FrontOrderId!=frontOrder.ToString()
                        || existing.PhotoId!=photoId || existing.Number!=number || existing.DeviceId!=route.Device.ToString()
                        || existing.ReceiptProof!=route.Proof || existing.ReceiptPointCount!=route.PointCount) return false;
                    reason="ready";return true;
                }
                if(bindings.Count>=MaximumBindings) {reason="queue_full";return false;}
                bindings.Add(key,new PickupPhotoRouteBinding {BranchId=branch,TerminalId=terminal,OrderId=orderId,
                    FrontOrderId=frontOrder.ToString(),PhotoId=photoId,Number=number,DeviceId=route.Device.ToString(),
                    QueueId=null,SectionId="none",Kind="receipt",Phase="reserved",ReceiptProof=route.Proof,ReceiptPointCount=route.PointCount});
                SaveBindings(null);reason=healthy ? "ready" : "journal_unhealthy";return healthy;
            }
        }
    }
}
