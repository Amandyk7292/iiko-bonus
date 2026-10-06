using System;
using System.IO;
using System.Security.Cryptography;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml.Linq;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class PickupPhotoRaster
    {
        internal const int MaximumBytes=500*1024;
        internal const int MaximumHeight=1800;
        internal static int WidthDots
        {
            get
            {
                var configured=LoyaltyFlow.ReadPluginSetting("IIKO_PICKUP_PHOTO_WIDTH_DOTS");
                if(string.IsNullOrWhiteSpace(configured)) return 384;
                if(configured=="384") return 384;
                if(configured=="576") return 576;
                throw new InvalidOperationException("Ширина фотопечати должна быть 384 или 576 точек.");
            }
        }
        private static uint UInt32(byte[] bytes,int start) =>
            ((uint)bytes[start]<<24)|((uint)bytes[start+1]<<16)|((uint)bytes[start+2]<<8)|bytes[start+3];
        internal static string Hash(byte[] bytes)
        {
            using(var hash=SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
        }
        internal static Document Prepare(byte[] bytes,int widthDots)
        {
            if(widthDots!=384 && widthDots!=576) throw new InvalidDataException("Недопустимая ширина фотопечати.");
            if(bytes==null || bytes.Length<33 || bytes.Length>MaximumBytes
                || bytes[0]!=137 || bytes[1]!=80 || bytes[2]!=78 || bytes[3]!=71
                || bytes[4]!=13 || bytes[5]!=10 || bytes[6]!=26 || bytes[7]!=10
                || UInt32(bytes,8)!=13 || bytes[12]!=73 || bytes[13]!=72 || bytes[14]!=68 || bytes[15]!=82)
                throw new InvalidDataException("Нет подготовленного PNG для фотопечати.");
            var width=UInt32(bytes,16);var height=UInt32(bytes,20);
            if(width!=widthDots || height<1 || height>MaximumHeight)
                throw new InvalidDataException("Размер фотографии превышает формат ленты.");
            // Reject animated/multi-frame PNG before invoking any decoder.
            var cursor=8;
            while(cursor<=bytes.Length-12)
            {
                var length=UInt32(bytes,cursor);
                if(length>(uint)(bytes.Length-cursor-12)) throw new InvalidDataException("Повреждённый PNG.");
                if(bytes[cursor+4]==97 && bytes[cursor+5]==99 && bytes[cursor+6]==84 && bytes[cursor+7]==76)
                    throw new InvalidDataException("Для печати нужна одна фотография.");
                cursor+=checked((int)length+12);
            }
            if(cursor!=bytes.Length) throw new InvalidDataException("Повреждённый PNG.");
            using(var stream=new MemoryStream(bytes,false))
            {
                var decoder=BitmapDecoder.Create(stream,BitmapCreateOptions.IgnoreColorProfile,BitmapCacheOption.OnLoad);
                if(decoder.Frames.Count!=1) throw new InvalidDataException("Для печати нужна одна фотография.");
                var frame=decoder.Frames[0];
                if(frame.PixelWidth!=width || frame.PixelHeight!=height)
                    throw new InvalidDataException("Недопустимый размер PNG.");
                var rgb=new FormatConvertedBitmap(frame,PixelFormats.Bgra32,null,0);
                var pixels=new byte[checked(frame.PixelWidth*frame.PixelHeight*4)];
                rgb.CopyPixels(pixels,frame.PixelWidth*4,0);
                // The server has already dithered the photograph. A 1-bit BMP
                // preserves those dots for the SDK's monochrome image tag.
                var rowBytes=((frame.PixelWidth+31)/32)*4;
                using(var output=new MemoryStream())
                using(var writer=new BinaryWriter(output))
                {
                    writer.Write((ushort)0x4D42);writer.Write(62+rowBytes*frame.PixelHeight);
                    writer.Write(0);writer.Write(62);writer.Write(40);
                    writer.Write(frame.PixelWidth);writer.Write(frame.PixelHeight);
                    writer.Write((ushort)1);writer.Write((ushort)1);writer.Write(0);
                    writer.Write(rowBytes*frame.PixelHeight);writer.Write(0);writer.Write(0);
                    writer.Write(2);writer.Write(2);writer.Write(0);writer.Write(0x00FFFFFF);
                    for(var y=frame.PixelHeight-1;y>=0;y--)
                    {
                        var row=new byte[rowBytes];
                        for(var x=0;x<frame.PixelWidth;x++)
                        {
                            var index=(y*frame.PixelWidth+x)*4;
                            var b=pixels[index];var g=pixels[index+1];var r=pixels[index+2];var a=pixels[index+3];
                            if(a!=255 || b!=g || g!=r || (r!=0 && r!=255))
                                throw new InvalidDataException("Фотография не подготовлена для чёрно-белой печати.");
                            if(r==255) row[x/8]|=(byte)(0x80>>(x%8));
                        }
                        writer.Write(row);
                    }
                    writer.Flush();
                    return (Document)new XElement("doc",new XElement("image",new XAttribute("align","center"),
                        Convert.ToBase64String(output.ToArray())),new XElement("br"));
                }
            }
        }
    }
}
