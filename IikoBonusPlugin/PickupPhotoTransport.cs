using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class PickupPhotoTransport
    {
        private static readonly HttpClient client=new HttpClient(new HttpClientHandler {AllowAutoRedirect=false})
            {Timeout=TimeSpan.FromSeconds(15)};
        internal static PickupPhotoResponse Post(string endpoint,object payload,string terminalId)
        {
            if(endpoint!="poll" && endpoint!="action") throw new InvalidOperationException("Недопустимое действие фотопечати.");
            var body=Send(HttpMethod.Post,endpoint,terminalId,payload,false);
            var result=LoyaltyFlow.DeserializeJson<PickupPhotoResponse>(Encoding.UTF8.GetString(body));
            if(result?.Success!=true) throw new InvalidOperationException("Сервер не подтвердил задание фотопечати.");
            return result;
        }
        internal static byte[] Image(string orderId,string terminalId,int widthDots)
        {
            if(!Guid.TryParse(orderId,out var id) || (widthDots!=384 && widthDots!=576))
                throw new InvalidOperationException("Недопустимое задание фотопечати.");
            return Send(HttpMethod.Get,id.ToString()+"/image?terminalId="+Uri.EscapeDataString(terminalId)
                +"&widthDots="+widthDots,terminalId,null,true);
        }
        private static byte[] Send(HttpMethod method,string endpoint,string terminalId,object payload,bool image)
        {
            var paired=PosPairing.Current;
            if(!PosPairing.IsPaired || !Guid.TryParse(terminalId,out var terminal)
                || !Guid.TryParse(paired.TerminalId,out var pairedTerminal) || terminal!=pairedTerminal)
                throw new InvalidOperationException("Сначала привяжите эту кассу к филиалу.");
            var configured=LoyaltyFlow.ReadPluginSetting("IIKO_LOYALTY_API_BASE_URL") ?? "https://bulka.com.kz/api/loyalty";
            if(!Uri.TryCreate(configured.TrimEnd('/')+"/",UriKind.Absolute,out var baseUri)
                || baseUri.Scheme!=Uri.UriSchemeHttps || !string.IsNullOrEmpty(baseUri.UserInfo)
                || !string.IsNullOrEmpty(baseUri.Query) || !string.IsNullOrEmpty(baseUri.Fragment))
                throw new InvalidOperationException("Для фотопечати нужен защищённый адрес Bulka.");
            var requestUri=new Uri(baseUri,"orders/photo-gifts/"+endpoint);
            using(var request=new HttpRequestMessage(method,requestUri))
            using(var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(15)))
            {
                request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",paired.Token);
                request.Headers.TryAddWithoutValidation("X-Bulka-Branch-Id",paired.BranchId);
                request.Headers.TryAddWithoutValidation("X-Bulka-Terminal-Id",terminalId);
                request.Headers.TryAddWithoutValidation("X-Bulka-Plugin-Version",PosHealthSync.Version);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(image ? "image/png" : "application/json"));
                if(payload!=null)
                {
                    using(var output=new MemoryStream())
                    {
                        new DataContractJsonSerializer(payload.GetType()).WriteObject(output,payload);
                        request.Content=new StringContent(Encoding.UTF8.GetString(output.ToArray()),Encoding.UTF8,"application/json");
                    }
                }
                using(var response=client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,deadline.Token).GetAwaiter().GetResult())
                {
                    if(!response.IsSuccessStatusCode || response.Content==null)
                        throw new InvalidOperationException("Нет подтверждения Bulka для фотопечати.");
                    if(image && response.Content.Headers.ContentType?.MediaType!="image/png")
                        throw new InvalidDataException("Нет подготовленного PNG для фотопечати.");
                    var maximum=image ? PickupPhotoRaster.MaximumBytes : 64*1024;
                    if(response.Content.Headers.ContentLength>maximum)
                        throw new InvalidDataException("Ответ фотопечати превышает допустимый размер.");
                    using(var input=response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                    using(var output=new MemoryStream())
                    {
                        var buffer=new byte[8192];int count;
                        while((count=input.ReadAsync(buffer,0,buffer.Length,deadline.Token).GetAwaiter().GetResult())>0)
                        {
                            if(output.Length+count>maximum) throw new InvalidDataException("Ответ фотопечати превышает допустимый размер.");
                            output.Write(buffer,0,count);
                        }
                        var bytes=output.ToArray();
                        if(image && response.Headers.TryGetValues("X-Content-SHA256",out var values)
                            && !string.Equals(values.SingleOrDefault(),PickupPhotoRaster.Hash(bytes),StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("Подготовленная фотография повреждена при передаче.");
                        return bytes;
                    }
                }
            }
        }
    }
}
