package ng.processedge.sellertray.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class SellerTrayBluetoothPrinterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SellerTrayBluetoothPrinter")

    Function("isAvailable") {
      bluetoothAdapterOrNull() != null
    }

    AsyncFunction("getBondedDevices") {
      requireConnectPermission()
      val adapter = requireBluetoothAdapter()
      requireBluetoothEnabled(adapter)
      bondedDevices(adapter)
    }

    AsyncFunction("write") { address: String, payloadBase64: String ->
      requireConnectPermission()
      val adapter = requireBluetoothAdapter()
      requireBluetoothEnabled(adapter)
      writeToPairedDevice(adapter, address, payloadBase64)
    }
  }

  private fun bluetoothAdapterOrNull(): BluetoothAdapter? {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun requireBluetoothAdapter(): BluetoothAdapter =
    bluetoothAdapterOrNull() ?: throw IllegalStateException("Bluetooth is unavailable on this device.")

  private fun requireBluetoothEnabled(adapter: BluetoothAdapter) {
    if (!adapter.isEnabled) {
      throw IllegalStateException("Turn on Bluetooth before using the printer.")
    }
  }

  private fun requireConnectPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
      && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      throw SecurityException("Bluetooth printer permission is required.")
    }
  }

  @SuppressLint("MissingPermission")
  private fun bondedDevices(adapter: BluetoothAdapter): List<Map<String, String>> =
    adapter.bondedDevices
      .sortedWith(compareBy({ it.name ?: "" }, { it.address }))
      .map { device ->
        mapOf(
          "name" to (device.name?.takeIf { it.isNotBlank() } ?: "Bluetooth device"),
          "address" to device.address,
        )
      }

  @SuppressLint("MissingPermission")
  private fun writeToPairedDevice(
    adapter: BluetoothAdapter,
    rawAddress: String,
    payloadBase64: String,
  ): Map<String, Int> {
    val address = rawAddress.trim().uppercase()
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw IllegalArgumentException("Selected Bluetooth printer address is invalid.")
    }

    val payload = try {
      Base64.decode(payloadBase64, Base64.NO_WRAP)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("Printer payload is invalid.")
    }
    if (payload.isEmpty()) {
      throw IllegalArgumentException("Printer payload is empty.")
    }

    val device = adapter.getRemoteDevice(address)
    if (device.bondState != BluetoothDevice.BOND_BONDED) {
      throw IllegalStateException("This printer is not paired with Android.")
    }

    val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
    try {
      socket.connect()
      val output = socket.outputStream
      output.write(payload)
      output.flush()
      return mapOf("bytesWritten" to payload.size)
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
        // Closing a printer socket must not replace the actual print result.
      }
    }
  }

  companion object {
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}
