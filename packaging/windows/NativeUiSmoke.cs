using System;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// A local protocol fixture: no real installation, account, model or hotkey.
public static class NativeUiSmoke {
 [STAThread] public static void Main(string[] args) {
  Application.EnableVisualStyles();
  Application.SetCompatibleTextRenderingDefault(false);
  string root=AppDomain.CurrentDomain.BaseDirectory;
  string engine=Path.GetDirectoryName(root.TrimEnd(Path.DirectorySeparatorChar));
  string home=Path.Combine(engine,"synthetic-home");
  var assembly=Assembly.LoadFrom(Path.Combine(root,"Feiyu.UI.exe"));
  var type=assembly.GetType("Launcher");
  var fields=BindingFlags.Instance|BindingFlags.NonPublic;
  var form=(Form)Activator.CreateInstance(type,new object[]{new string[]{"--home="+home,"--engine-root="+engine}});
  form.Opacity=0;form.ShowInTaskbar=false;
  var result=new Dictionary<string,object>();
  form.Shown+=async(sender,eventArgs)=>{
   try {
    await Task.Delay(700);
    for(int i=0;i<100&&(bool)type.GetField("busy",fields).GetValue(form);i++)await Task.Delay(100);
    var log=(TextBox)type.GetField("log",fields).GetValue(form);
    if((bool)type.GetField("busy",fields).GetValue(form)||!log.Text.Contains("fixture-native"))throw new Exception("Initial status/early-exit pipe regression");
    foreach(string action in new[]{"status","status","configure","stop","status"})
     await (Task)type.GetMethod("Run",fields).Invoke(form,new object[]{action,new Dictionary<string,object>{{"fixture","native-fixture"}},null});
    var shortcuts=assembly.GetType("NativeShortcuts");
    string folder=Path.Combine(engine,"unicode-case");Directory.CreateDirectory(folder);
    string link=Path.Combine(folder,"\u80a5\u9c7c-\ud83d\udc1f.lnk");
    string target=Path.GetFullPath(Path.Combine(engine,"runtime/node-v24.19.0-win-x64/node.exe"));
    string argument="--home=\""+Path.Combine(folder,"\u4e2d\u6587 \ud83d\udc1f")+"\"";
    shortcuts.GetMethod("Write").Invoke(null,new object[]{link,target,argument,folder});
    string actualTarget=(string)shortcuts.GetMethod("ReadTarget").Invoke(null,new object[]{link});
    string actualArgs=(string)shortcuts.GetMethod("ReadArguments").Invoke(null,new object[]{link});
    result["unicodeFileExists"]=File.Exists(link);result["unicodeTargetMatches"]=string.Equals(target,actualTarget,StringComparison.OrdinalIgnoreCase);result["unicodeArgumentsMatch"]=actualArgs==argument;
    if(!(bool)result["unicodeFileExists"]||!(bool)result["unicodeTargetMatches"]||!(bool)result["unicodeArgumentsMatch"])throw new Exception("Unicode shortcut round trip failed");
    result["ok"]=true;result["managerRoundTrips"]=6;result["unicodeShortcut"]=true;result["realServicesStarted"]=false;
   } catch(Exception error) {
    result["ok"]=false;result["error"]=error.InnerException==null?error.Message:error.InnerException.Message;Environment.ExitCode=1;
   } finally {
    File.WriteAllText(Path.Combine(engine,"native-results.json"),new JavaScriptSerializer().Serialize(result));
    type.GetField("busy",fields).SetValue(form,false);form.Close();
   }
  };
  Application.Run(form);
 }
}
