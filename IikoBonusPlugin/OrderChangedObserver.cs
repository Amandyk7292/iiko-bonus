using System;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;

namespace Resto.Front.Api.IikoBonusPlugin
{
    public class OrderChangedObserver : IObserver<EntityChangedEventArgs<IOrder>>
    {
        private readonly Action<EntityChangedEventArgs<IOrder>> _onNext;

        public OrderChangedObserver(Action<EntityChangedEventArgs<IOrder>> onNext)
        {
            _onNext = onNext;
        }

        public void OnCompleted() { }
        public void OnError(Exception error) { }
        public void OnNext(EntityChangedEventArgs<IOrder> value)
        {
            _onNext?.Invoke(value);
        }
    }
}
