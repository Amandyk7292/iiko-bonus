using System;
using System.Runtime.Remoting;
using Resto.Front.Api;
using Resto.Front.Api.Attributes;

namespace IikoBonusPlugin
{
    [PluginLicenseModuleId(0)]
    public class PluginEntry : IFrontPlugin
    {
        private IDisposable _subscription;

        public PluginEntry()
        {
            PluginContext.Log.Info("IikoBonusPlugin is initializing...");
            
            // Register a button on the order edit screen
            _subscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                "Списать бонусы",
                args =>
                {
                    try
                    {
                        var window = new UI.BonusWindow(args.order, args.os);
                        window.ShowDialog();
                    }
                    catch (Exception ex)
                    {
                        PluginContext.Log.Error("Error opening bonus window", ex);
                    }
                }
            );

            PluginContext.Log.Info("IikoBonusPlugin initialized successfully.");
        }

        public void Dispose()
        {
            _subscription?.Dispose();
            PluginContext.Log.Info("IikoBonusPlugin disposed.");
        }
    }
}
