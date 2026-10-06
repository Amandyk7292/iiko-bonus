using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class PickupPhotoReceiptRoute
    {
        internal const int MaximumPoints=32;
        internal string Branch,Terminal,Proof;
        internal Guid Device;
        internal int PointCount,Generation;
        internal static bool TryResolve(IOperationService os,out PickupPhotoReceiptRoute route,out string diagnostic)
        {
            route=null;diagnostic=null;
            try
            {
                var branch=LoyaltyFlow.BranchId;var terminal=os.GetHostTerminal().Id;
                var points=os.GetHostTerminalPointsOfSale();
                if(points==null || points.Count==0) return false;
                if(points.Count>MaximumPoints) {diagnostic="receipt_points_capacity";return false;}
                var source=new List<string>();var pointIds=new HashSet<Guid>();Guid? device=null;
                foreach(var point in points)
                {
                    var register=point?.CashRegister;
                    if(point==null || point.Id==Guid.Empty || !pointIds.Add(point.Id) || register==null
                        || register.Id==Guid.Empty || !register.IsVirtual || !register.VirtualChequePrinterId.HasValue
                        || register.VirtualChequePrinterId.Value==Guid.Empty)
                    {diagnostic="receipt_source_unavailable count="+points.Count;return false;}
                    var target=register.VirtualChequePrinterId.Value;
                    if(device.HasValue && device!=target) {diagnostic="receipt_targets_ambiguous count="+points.Count;return false;}
                    device=target;source.Add(point.Id.ToString("D")+"|"+register.Id.ToString("D")+"|"+target.ToString("D"));
                }
                // These are exact host POS -> virtual cash register -> physical
                // receipt-printer configuration identities, never a guessed queue.
                source.Sort(StringComparer.Ordinal);
                route=new PickupPhotoReceiptRoute {Branch=branch,Terminal=terminal.ToString(),Device=device.Value,
                    PointCount=points.Count,Proof=PickupPhotoRaster.Hash(Encoding.UTF8.GetBytes(string.Join("\n",source))),
                    Generation=PickupPhotoRoutes.ReceiptGeneration};
                return true;
            }
            catch(Exception error) {diagnostic="receipt_source_failed type="+error.GetType().Name;return false;}
        }
    }
}
