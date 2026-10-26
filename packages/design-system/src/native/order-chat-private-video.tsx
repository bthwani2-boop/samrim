import { useVideoPlayer, VideoView } from "expo-video";
export default function PrivateVideo({uri}:{uri:string}){
 const player=useVideoPlayer({uri,useCaching:false});
 return <VideoView player={player} nativeControls contentFit="contain"
   surfaceType="textureView" style={{width:230,height:175,borderRadius:12}}/>;
}
