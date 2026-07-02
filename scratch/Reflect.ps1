$path = "C:\Users\Asus Rog\.nuget\packages\resto.front.api.v9\9.5.6059\lib\netstandard2.0\Resto.Front.Api.V9.dll"
[Reflection.Assembly]::LoadFrom($path) | Out-Null
$type = [Resto.Front.Api.Data.Orders.IOrder]
$type.GetProperties() | Select-Object Name | Out-String
