 import { useState } from "react";
 import { File, Download, Image, Video, FileText, X } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { useSignedFileUrl } from "@/lib/storedFiles";
 import {
   Dialog,
   DialogContent,
   DialogTitle,
 } from "@/components/ui/dialog";
 
 interface FileAttachmentProps {
   url: string;
   name: string;
   size: number;
 }
 
 export function FileAttachment({ url: storedUrl, name, size }: FileAttachmentProps) {
   // Chat files are private; a fresh link is made each time the message is shown.
   const url = useSignedFileUrl(storedUrl) ?? "";
   const [lightboxOpen, setLightboxOpen] = useState(false);
 
   const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
   const isVideo = /\.(mp4|webm|mov)$/i.test(name);
   const isPdf = /\.pdf$/i.test(name);
 
   const formatSize = (bytes: number) => {
     if (bytes < 1024) return `${bytes} B`;
     if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
     return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
   };
 
   const getIcon = () => {
     if (isImage) return <Image className="h-5 w-5" />;
     if (isVideo) return <Video className="h-5 w-5" />;
     if (isPdf) return <FileText className="h-5 w-5" />;
     return <File className="h-5 w-5" />;
   };
 
   if (isImage) {
     return (
       <>
         <button
           onClick={() => setLightboxOpen(true)}
           className="block max-w-[200px] rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
         >
           <img
             src={url}
             alt={name}
             className="w-full h-auto object-cover"
           />
           <div className="text-xs text-muted-foreground mt-1 truncate px-1">
             {name}
           </div>
         </button>
 
         <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
           <DialogContent className="max-w-4xl p-0 overflow-hidden">
             <DialogTitle className="sr-only">{name}</DialogTitle>
             <div className="relative">
               <Button
                 variant="ghost"
                 size="icon"
                 className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white"
                 onClick={() => setLightboxOpen(false)}
               >
                 <X className="h-5 w-5" />
               </Button>
               <img
                 src={url}
                 alt={name}
                 className="w-full h-auto max-h-[80vh] object-contain"
               />
             </div>
           </DialogContent>
         </Dialog>
       </>
     );
   }
 
   if (isVideo) {
     return (
       <div className="max-w-[300px] rounded-lg overflow-hidden">
         <video
           src={url}
           controls
           className="w-full h-auto"
         />
         <div className="text-xs text-muted-foreground mt-1 truncate px-1">
           {name}
         </div>
       </div>
     );
   }
 
   return (
     <a
       href={url}
       target="_blank"
       rel="noopener noreferrer"
       className="flex items-center gap-3 p-3 bg-background/50 rounded-lg hover:bg-background/80 transition-colors"
     >
       <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
         {getIcon()}
       </div>
       <div className="flex-1 min-w-0">
         <p className="text-sm font-medium truncate">{name}</p>
         <p className="text-xs text-muted-foreground">{formatSize(size)}</p>
       </div>
       <Download className="h-4 w-4 text-muted-foreground" />
     </a>
   );
 }