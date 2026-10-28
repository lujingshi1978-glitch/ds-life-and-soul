// Trusted host launcher. Candidate code is never compiled or evaluated here.
// Windows LPAC (no network capability), explicit SID grants, clean environment, and
// a kill-on-close Job apply to the initial process and every descendant.
using System;using System.IO;using System.Text;using System.Linq;using System.Collections.Generic;
using System.Threading.Tasks;using System.Runtime.InteropServices;using System.ComponentModel;
using System.Security.AccessControl;using System.Security.Principal;using Microsoft.Win32.SafeHandles;
using System.Threading;
public static class FeiyuContainer {
 [StructLayout(LayoutKind.Sequential)]struct SA {public int nLength;public IntPtr descriptor;[MarshalAs(UnmanagedType.Bool)]public bool inherit;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct SI {public int cb;public string reserved,desktop,title;public int x,y,xs,ys,xc,yc,fill,flags;public short show,reserved2;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)]struct SIX {public SI si;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)]struct PI {public IntPtr process,thread;public int pid,tid;}
 [StructLayout(LayoutKind.Sequential)]struct CAPS {public IntPtr sid,capabilities;public int count,reserved;}
 [StructLayout(LayoutKind.Sequential)]struct BASIC {public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)]struct IO {public ulong ro,wo,other,rbytes,wbytes,obytes;}
 [StructLayout(LayoutKind.Sequential)]struct LIMIT {public BASIC basic;public IO io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [StructLayout(LayoutKind.Sequential)]struct ACCOUNT {public long user,kernel,userPeriod,kernelPeriod;public uint faults,total,active,terminated;}
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int DeleteAppContainerProfile(string name);
 [DllImport("advapi32.dll")]static extern IntPtr FreeSid(IntPtr sid);
 [DllImport("kernelbase.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool DeriveCapabilitySidsFromName(string name,out IntPtr groups,out uint groupCount,out IntPtr capabilities,out uint capabilityCount);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr value);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")]static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr env,string cwd,ref SIX info,out PI process);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA attributes,int size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern IntPtr CreateFileW(string name,uint access,uint share,ref SA attributes,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr CreateJobObjectW(IntPtr security,IntPtr name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int type,ref LIMIT limits,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(IntPtr job,int kind,out ACCOUNT value,uint length,IntPtr returned);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint QueryDosDeviceW(string name,StringBuilder target,int capacity);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool DefineDosDeviceW(uint flags,string name,string target);
 [DllImport("kernel32.dll")]static extern uint GetLogicalDrives();
 static void Check(bool yes,string label){if(!yes)throw new Win32Exception(Marshal.GetLastWin32Error(),label);}
 static IntPtr Sid(string name,bool create){IntPtr sid;int hr=create?CreateAppContainerProfile(name,name,"Feiyu isolated creation",IntPtr.Zero,0,out sid):DeriveAppContainerSidFromAppContainerName(name,out sid);if(hr==unchecked((int)0x800700B7))hr=DeriveAppContainerSidFromAppContainerName(name,out sid);if(hr<0)Marshal.ThrowExceptionForHR(hr);return sid;}
 public static string Prepare(string name){var sid=Sid(name,true);try{return new SecurityIdentifier(sid).Value;}finally{FreeSid(sid);}}
 static IntPtr Capability(string name){IntPtr groups,caps;uint gc,cc;Check(DeriveCapabilitySidsFromName(name,out groups,out gc,out caps,out cc),"derive capability");for(int i=0;i<gc;i++)LocalFree(Marshal.ReadIntPtr(groups,i*IntPtr.Size));LocalFree(groups);if(cc!=1)throw new Exception("CAPABILITY_COUNT_INVALID");var sid=Marshal.ReadIntPtr(caps);LocalFree(caps);return sid;}
 public static string RuntimeSid(){var sid=Capability("feiyuCreatorRuntimeRead");try{return new SecurityIdentifier(sid).Value;}finally{LocalFree(sid);}}
 public static bool DriveDefined(string name){var text=new StringBuilder(32768);if(QueryDosDeviceW(name,text,text.Capacity)!=0)return true;int code=Marshal.GetLastWin32Error();if(code==122)return true;if(code!=2)throw new Win32Exception(code,"query drive");return false;}
 static string DriveTarget(string name){var text=new StringBuilder(32768);return QueryDosDeviceW(name,text,text.Capacity)==0?null:text.ToString();}
 sealed class DriveLease:IDisposable {
  public string drive;string target,record;static string mutexName="Local\\Feiyu.Creator.DriveLease."+WindowsIdentity.GetCurrent().User.Value;
  public DriveLease(string mount,string leaseRecord){record=leaseRecord;
   target="\\??\\"+Path.GetFullPath(mount);using(var gate=new Mutex(false,mutexName)){bool acquired=false;try{try{acquired=gate.WaitOne(10000);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new Exception("CREATOR_DRIVE_LOCK_TIMEOUT");uint occupied=GetLogicalDrives();for(char letter='Z';letter>='M';letter--){var name=letter+":";if((occupied&(1u<<(letter-'A')))!=0||DriveDefined(name))continue;Check(DefineDosDeviceW(1|8,name,target),"create private drive");drive=name;if(!String.Equals(DriveTarget(name),target,StringComparison.OrdinalIgnoreCase))throw new Exception("CREATOR_DRIVE_IDENTITY_CHANGED");try{using(var self=System.Diagnostics.Process.GetCurrentProcess())File.WriteAllLines(record,new[]{drive,target,self.Id.ToString(),self.StartTime.ToUniversalTime().Ticks.ToString()});}catch{DefineDosDeviceW(1|2|4|8,drive,target);throw;}return;}throw new Exception("CREATOR_DRIVE_UNAVAILABLE");}finally{if(acquired)gate.ReleaseMutex();}}
  }
  public void Dispose(){if(drive==null)return;using(var gate=new Mutex(false,mutexName)){bool acquired=false;try{try{acquired=gate.WaitOne(10000);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new Exception("CREATOR_DRIVE_LOCK_TIMEOUT");if(!String.Equals(DriveTarget(drive),target,StringComparison.OrdinalIgnoreCase))throw new Exception("CREATOR_DRIVE_IDENTITY_CHANGED");Check(DefineDosDeviceW(1|2|4|8,drive,target),"remove private drive");if(String.Equals(DriveTarget(drive),target,StringComparison.OrdinalIgnoreCase))throw new Exception("CREATOR_DRIVE_NOT_REMOVED");drive=null;File.Delete(record);}finally{if(acquired)gate.ReleaseMutex();}}}
  public static bool Reap(string record,string mountBase){
   if(!File.Exists(record))return true;if(new FileInfo(record).Length>8192||(File.GetAttributes(record)&FileAttributes.ReparsePoint)!=0)throw new Exception("CREATOR_LEASE_INVALID");var rows=File.ReadAllLines(record);if(rows.Length!=4||rows[0].Length!=2||rows[0][0]<'M'||rows[0][0]>'Z'||rows[0][1]!=':'||!rows[1].StartsWith("\\??\\"+Path.GetFullPath(mountBase).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase))throw new Exception("CREATOR_LEASE_INVALID");
   try{using(var owner=System.Diagnostics.Process.GetProcessById(Int32.Parse(rows[2]))){if(!owner.HasExited&&owner.StartTime.ToUniversalTime().Ticks.ToString()==rows[3])return false;}}catch(ArgumentException){}
   using(var gate=new Mutex(false,mutexName)){bool acquired=false;try{try{acquired=gate.WaitOne(10000);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new Exception("CREATOR_DRIVE_LOCK_TIMEOUT");if(String.Equals(DriveTarget(rows[0]),rows[1],StringComparison.OrdinalIgnoreCase))Check(DefineDosDeviceW(1|2|4|8,rows[0],rows[1]),"reap private drive");File.Delete(record);return true;}finally{if(acquired)gate.ReleaseMutex();}}
  }
 }
 public static bool ReapLease(string record,string mountBase){return DriveLease.Reap(record,mountBase);}
 public static void VerifyGrant(string target,string sid,bool write){var acl=Directory.GetAccessControl(target);if(!acl.AreAccessRulesProtected||(File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0)throw new Exception("CREATOR_ACL_INVALID");var host=new[]{WindowsIdentity.GetCurrent().User.Value,"S-1-5-18","S-1-5-32-544"};var rules=acl.GetAccessRules(true,true,typeof(SecurityIdentifier));if(rules.Count!=4)throw new Exception("CREATOR_ACL_INVALID");foreach(FileSystemAccessRule rule in rules){var id=rule.IdentityReference.Value;var rights=host.Contains(id)?FileSystemRights.FullControl:id==sid?(write?FileSystemRights.Modify:FileSystemRights.ReadAndExecute):(FileSystemRights)0;if(rights==0)throw new Exception("CREATOR_ACL_INVALID");var expected=new FileSystemAccessRule(new SecurityIdentifier(id),rights,AccessControlType.Allow).FileSystemRights;if(rule.IsInherited||rule.AccessControlType!=AccessControlType.Allow||rule.FileSystemRights!=expected||rule.InheritanceFlags!=(InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit)||rule.PropagationFlags!=PropagationFlags.None)throw new Exception("CREATOR_ACL_INVALID");}}
 static string Mapped(string value,string workspace,string runtime,string system,string drive){return value.Replace(Path.GetFullPath(workspace),drive+"\\workspace").Replace(workspace,drive+"\\workspace").Replace(Path.GetFullPath(runtime),drive+"\\runtime").Replace(runtime,drive+"\\runtime").Replace(system,drive+"\\system32");}
 public static void Remove(string name){int hr=DeleteAppContainerProfile(name);if(hr<0)Marshal.ThrowExceptionForHR(hr);}
 public static void Grant(string target,string sid,bool write,bool directory){
  if((File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0)throw new Exception("REPARSE_DENIED");
  FileSystemSecurity acl=directory?(FileSystemSecurity)new DirectorySecurity():new FileSecurity();acl.SetAccessRuleProtection(true,false);
  var user=WindowsIdentity.GetCurrent().User;var host=new[]{user,new SecurityIdentifier("S-1-5-18"),new SecurityIdentifier("S-1-5-32-544")};
  var inherit=directory?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None;
  foreach(var id in host)acl.AddAccessRule(new FileSystemAccessRule(id,FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));
  acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),write?FileSystemRights.Modify:FileSystemRights.ReadAndExecute,inherit,PropagationFlags.None,AccessControlType.Allow));
  if(directory)Directory.SetAccessControl(target,(DirectorySecurity)acl);else File.SetAccessControl(target,(FileSecurity)acl);
 }
 public static string Quote(string value){if(value.IndexOf('\0')>=0)throw new Exception("NUL_ARGUMENT");if(value.Length>0&&!value.Any(c=>char.IsWhiteSpace(c)||c=='"'))return value;var b=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}b.Append('\\',slashes*2);return b.Append('"').ToString();}
 static string Drain(IntPtr handle){using(var file=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read))using(var reader=new StreamReader(file,Encoding.UTF8,true)){var b=new StringBuilder();char[] buffer=new char[4096];int n;while((n=reader.Read(buffer,0,buffer.Length))>0)if(b.Length<65536)b.Append(buffer,0,Math.Min(n,65536-b.Length));return b.ToString();}}
 public sealed class Result {public uint exitCode;public bool timedOut,cancelled,quiescent;public string stdout,stderr,executionDrive;public int pid;public bool lpac=true;public string[] capabilities=new[]{"registryRead","feiyuCreatorRuntimeRead","lpacInstrumentation"};}
 public static Result Run(string name,string executable,string[] args,string cwd,string[] environment,int timeout,string cancelFile,string mount,string workspace,string runtime){
  IntPtr sid=IntPtr.Zero,attrs=IntPtr.Zero,caps=IntPtr.Zero,opt=IntPtr.Zero,handles=IntPtr.Zero,env=IntPtr.Zero,job=IntPtr.Zero,outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,input=IntPtr.Zero,capabilitySid=IntPtr.Zero,runtimeSid=IntPtr.Zero,instrumentSid=IntPtr.Zero,capabilityRecords=IntPtr.Zero;PI pi=new PI();bool assigned=false,attributesInitialized=false;Task<string> outTask=null,errTask=null;
  DriveLease lease=null;try{
   if(File.Exists(cancelFile))return new Result{cancelled=true,quiescent=true,exitCode=125,stdout="",stderr=""};
   if(String.IsNullOrEmpty(mount)||!Directory.Exists(mount)||(File.GetAttributes(mount)&FileAttributes.ReparsePoint)!=0)throw new Exception("CREATOR_MOUNT_REQUIRED");
   sid=Sid(name,false);VerifyGrant(mount,new SecurityIdentifier(sid).Value,false);lease=new DriveLease(mount,cancelFile+".lease");string system=Environment.GetFolderPath(Environment.SpecialFolder.System);executable=Mapped(executable,workspace,runtime,system,lease.drive);cwd=Mapped(cwd,workspace,runtime,system,lease.drive);environment=environment.Select(value=>Mapped(value,workspace,runtime,system,lease.drive)).ToArray();
   var sa=new SA{nLength=Marshal.SizeOf(typeof(SA)),inherit=true};Check(CreatePipe(out outRead,out outWrite,ref sa,0),"stdout pipe");Check(CreatePipe(out errRead,out errWrite,ref sa,0),"stderr pipe");Check(SetHandleInformation(outRead,1,0),"stdout inheritance");Check(SetHandleInformation(errRead,1,0),"stderr inheritance");input=CreateFileW("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);Check(input!=new IntPtr(-1),"stdin NUL");
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size);attrs=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attrs,3,0,ref size),"attribute list");attributesInitialized=true;
   capabilitySid=Capability("registryRead");runtimeSid=Capability("feiyuCreatorRuntimeRead");instrumentSid=Capability("lpacInstrumentation");capabilityRecords=Marshal.AllocHGlobal(48);int capIndex=0;foreach(var capSid in new[]{capabilitySid,runtimeSid,instrumentSid}){Marshal.WriteIntPtr(capabilityRecords,capIndex*16,capSid);Marshal.WriteInt32(capabilityRecords,capIndex*16+8,4);Marshal.WriteInt32(capabilityRecords,capIndex*16+12,0);capIndex++;}
   var security=new CAPS{sid=sid,capabilities=capabilityRecords,count=3};caps=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CAPS)));Marshal.StructureToPtr(security,caps,false);Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20009),caps,new IntPtr(Marshal.SizeOf(typeof(CAPS))),IntPtr.Zero,IntPtr.Zero),"AppContainer capabilities");
   opt=Marshal.AllocHGlobal(4);Marshal.WriteInt32(opt,1);Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x2000f),opt,new IntPtr(4),IntPtr.Zero,IntPtr.Zero),"LPAC opt-out");
   handles=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,outWrite);Marshal.WriteIntPtr(handles,IntPtr.Size*2,errWrite);Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"stdio handle allowlist");
   env=Marshal.StringToHGlobalUni(string.Join("\0",environment.OrderBy(x=>x,StringComparer.OrdinalIgnoreCase))+"\0\0");
   job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);Check(job!=IntPtr.Zero,"job");var limits=new LIMIT();limits.basic.flags=0x2000|0x8|0x200;limits.basic.active=24;limits.jobMemory=new UIntPtr(1073741824);Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(LIMIT))),"job limits");
   var startup=new SIX();startup.si.cb=Marshal.SizeOf(typeof(SIX));startup.si.flags=0x101;startup.si.input=input;startup.si.output=outWrite;startup.si.error=errWrite;startup.attributes=attrs;
   var command=new StringBuilder(Quote(executable)+" "+string.Join(" ",args.Select(Quote)));if(command.Length>30000)throw new Exception("COMMAND_TOO_LONG");
   Check(CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x80000|0x400|0x4|0x8000000,env,cwd,ref startup,out pi),"create LPAC process");
   Check(AssignProcessToJobObject(job,pi.process),"assign job");assigned=true;Check(ResumeThread(pi.thread)!=0xffffffff,"resume");
   CloseHandle(outWrite);outWrite=IntPtr.Zero;CloseHandle(errWrite);errWrite=IntPtr.Zero;CloseHandle(input);input=IntPtr.Zero;
   var or=outRead;outRead=IntPtr.Zero;var er=errRead;errRead=IntPtr.Zero;outTask=Task.Run(()=>Drain(or));errTask=Task.Run(()=>Drain(er));
   var clock=System.Diagnostics.Stopwatch.StartNew();uint waited;bool cancelled=false,expired=false;
   while((waited=WaitForSingleObject(pi.process,50))==258){if(File.Exists(cancelFile)){cancelled=true;break;}if(clock.ElapsedMilliseconds>=timeout){expired=true;break;}}
   if(waited!=0&&waited!=258)throw new Win32Exception(Marshal.GetLastWin32Error(),"wait");
   if(expired||cancelled)Check(TerminateJobObject(job,cancelled?125u:124u),"cancel/timeout terminate");WaitForSingleObject(pi.process,5000);uint code;Check(GetExitCodeProcess(pi.process,out code),"exit code");
   Check(TerminateJobObject(job,code),"descendant cleanup");bool empty=false;for(int n=0;n<1000;n++){ACCOUNT account;Check(QueryInformationJobObject(job,1,out account,(uint)Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero),"job quiescence");if(account.active==0){empty=true;break;}Thread.Sleep(5);}if(!empty)throw new Exception("JOB_NOT_QUIESCENT");Task.WaitAll(new Task[]{outTask,errTask},10000);
   if(!outTask.IsCompleted||!errTask.IsCompleted)throw new Exception("PIPE_DRAIN_TIMEOUT");return new Result{exitCode=code,timedOut=expired,cancelled=cancelled,quiescent=true,stdout=outTask.Result,stderr=errTask.Result,pid=pi.pid,executionDrive=lease.drive};
  }finally{
   if(pi.process!=IntPtr.Zero&&!assigned)TerminateProcess(pi.process,125);if(job!=IntPtr.Zero){TerminateJobObject(job,125);CloseHandle(job);}if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
   foreach(var h in new[]{input,outWrite,errWrite,outRead,errRead})if(h!=IntPtr.Zero&&h!=new IntPtr(-1))CloseHandle(h);
   if(attributesInitialized)DeleteProcThreadAttributeList(attrs);foreach(var p in new[]{attrs,caps,opt,handles,env,capabilityRecords})if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);if(capabilitySid!=IntPtr.Zero)LocalFree(capabilitySid);if(runtimeSid!=IntPtr.Zero)LocalFree(runtimeSid);if(instrumentSid!=IntPtr.Zero)LocalFree(instrumentSid);if(sid!=IntPtr.Zero)FreeSid(sid);if(lease!=null)lease.Dispose();
  }
 }
}
