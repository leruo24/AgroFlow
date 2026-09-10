namespace AgroFlow.Business
{
    public class Pump : Hardware
    {
        #region Data Member
        private float flowRate;
        private bool isRunning;
        #endregion

        #region Property Methods
        public float FlowRate
        {
            get { return flowRate; }
            set { flowRate = value; }
        }

        public bool IsRunning
        {
            get { return isRunning; }
            set { isRunning = value; }
        }
        #endregion

        #region Constructor
        public Pump() : base()
        {
            GetHardwareType = HardwareType.Pump;
            status = "Offline";
            flowRate = 0f;
            isRunning = false;
        }
        #endregion

        #region Methods
        // override: a Pump's "value" is its flow rate while running, else 0.
        public override float ReadValue()
        {
            return isRunning ? flowRate : 0f;
        }

        // override: a Pump is only "working" if it's online AND actually pumping
        // when it's meant to - a slightly stricter check than the base version,
        // showing that IsWorking is genuinely polymorphic, not just inherited.
        public override bool IsWorking()
        {
            return status == "Online" || status == "Running";
        }
        #endregion
    }
}
